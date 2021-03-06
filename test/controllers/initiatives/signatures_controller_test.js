var _ = require("root/lib/underscore")
var Url = require("url")
var Yauzl = require("yauzl")
var DateFns = require("date-fns")
var Config = require("root/config")
var ValidInitiative = require("root/test/valid_db_initiative")
var ValidSignature = require("root/test/valid_signature")
var Certificate = require("undersign/lib/certificate")
var X509Asn = require("undersign/lib/x509_asn")
var Ocsp = require("undersign/lib/ocsp")
var Http = require("root/lib/http")
var Crypto = require("crypto")
var respond = require("root/test/fixtures").respond
var sql = require("sqlate")
var t = require("root/lib/i18n").t.bind(null, Config.language)
var slurp = require("root/lib/stream").slurp
var newCertificate = require("root/test/fixtures").newCertificate
var newOcspResponse = require("root/test/fixtures").newOcspResponse
var newPartner = require("root/test/citizenos_fixtures").newPartner
var newTopic = require("root/test/citizenos_fixtures").newTopic
var newVote = require("root/test/citizenos_fixtures").newVote
var newSignature = require("root/test/citizenos_fixtures").newSignature
var createPartner = require("root/test/citizenos_fixtures").createPartner
var createUser = require("root/test/fixtures").createUser
var createTopic = require("root/test/citizenos_fixtures").createTopic
var createVote = require("root/test/citizenos_fixtures").createVote
var createCitizenSignature
	= require("root/test/citizenos_fixtures").createSignature
var createOptions = require("root/test/citizenos_fixtures").createOptions
var initiativesDb = require("root/db/initiatives_db")
var signaturesDb = require("root/db/initiative_signatures_db")
var signablesDb = require("root/db/initiative_signables_db")
var hades = require("root").hades
var demand = require("must")
var next = require("co-next")
var encodeBase64 = require("root/lib/crypto").encodeBase64
var tsl = require("root").tsl
var ASICE_TYPE = "application/vnd.etsi.asic-e+zip"
var MOBILE_ID_URL = Url.parse("https://mid.sk.ee/mid-api/")
var SMART_ID_URL = Url.parse("https://rp-api.smart-id.com/v1/")
var TIMEMARK_URL = Url.parse(Config.timemarkUrl)
var CERTIFICATE_TYPE = "application/pkix-cert"
var ERR_TYPE = "application/vnd.rahvaalgatus.error+json"
var SIGNABLE_TYPE = "application/vnd.rahvaalgatus.signable"
var SIGNATURE_TYPE = "application/vnd.rahvaalgatus.signature"
var NEW_SIG_TRESHOLD = 15
var PERSONAL_ID = "38706181337"
var VALID_ISSUERS = require("root/test/fixtures").VALID_ISSUERS
var JOHN_RSA_KEYS = require("root/test/fixtures").JOHN_RSA_KEYS
var JOHN_ECDSA_KEYS = require("root/test/fixtures").JOHN_ECDSA_KEYS
var SESSION_ID = "7c8bdd56-6772-4264-ba27-bf7a9ef72a11"
var {PHONE_NUMBER_TRANSFORMS} = require("root/test/fixtures")
var SMART_ID = "PNOEE-" + PERSONAL_ID + "-R2D2-Q"

// Appending a JWT signature containing only alphanumeric characters checks for
// a bug noticed on Jan 12, 2020, which interpreted the suffix as a MIME
// extension and removed it in favor of setting the Accept header.
var AUTH_TOKEN = "deadbeef.uSdEdl6xvAD0DmFDLnX2xIAsTWWquvsRm1NNg32pcVg"
var SIGN_TOKEN = "feedfed.uSdEdl6xvAD0DmFDLnX2xIAsTWWquvsRm1NNg32pcVg"

var ID_CARD_CERTIFICATE = new Certificate(newCertificate({
	subject: {
		countryName: "EE",
		organizationName: "ESTEID",
		organizationalUnitName: "digital signature",
		commonName: `SMITH,JOHN,${PERSONAL_ID}`,
		surname: "SMITH",
		givenName: "JOHN",
		serialNumber: `PNOEE-${PERSONAL_ID}`
	},

	issuer: VALID_ISSUERS[0],
	publicKey: JOHN_RSA_KEYS.publicKey
}))

var MOBILE_ID_CERTIFICATE = new Certificate(newCertificate({
	subject: {
		countryName: "EE",
		organizationName: "ESTEID (MOBIIL-ID)",
		organizationalUnitName: "digital signature",
		commonName: `SMITH,JOHN,${PERSONAL_ID}`,
		surname: "SMITH",
		givenName: "JOHN",
		serialNumber: `PNOEE-${PERSONAL_ID}`
	},

	issuer: VALID_ISSUERS[0],
	publicKey: JOHN_RSA_KEYS.publicKey
}))

var SMART_ID_CERTIFICATE = new Certificate(newCertificate({
	subject: {
		countryName: "EE",
		organizationalUnitName: "SIGNATURE",
		commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
		surname: "SMITH",
		givenName: "JOHN",
		serialNumber: `PNOEE-${PERSONAL_ID}`
	},

	issuer: VALID_ISSUERS[0],
	publicKey: JOHN_RSA_KEYS.publicKey
}))

var MOBILE_ID_CREATE_ERRORS = {
	NOT_FOUND: [
		422,
		"Not a Mobile-Id User or Personal Id Mismatch",
		"MOBILE_ID_ERROR_NOT_FOUND"
	],

	NOT_ACTIVE: [
		422,
		"Mobile-Id Certificates Not Activated",
		"MOBILE_ID_ERROR_NOT_ACTIVE"
	]
}

var MOBILE_ID_SESSION_ERRORS = {
	TIMEOUT: [
		410,
		"Mobile-Id Timeout",
		"MOBILE_ID_ERROR_TIMEOUT"
	],

	NOT_MID_CLIENT: [
		410,
		"Mobile-Id Certificates Not Activated",
		"MOBILE_ID_ERROR_NOT_ACTIVE"
	],

	USER_CANCELLED: [
		410,
		"Mobile-Id Cancelled",
		"MOBILE_ID_ERROR_USER_CANCELLED"
	],

	SIGNATURE_HASH_MISMATCH: [
		410,
		"Mobile-Id Signature Hash Mismatch",
		"MOBILE_ID_ERROR_SIGNATURE_HASH_MISMATCH"
	],

	PHONE_ABSENT: [
		410,
		"Mobile-Id Phone Absent",
		"MOBILE_ID_ERROR_PHONE_ABSENT"
	],

	DELIVERY_ERROR: [
		410,
		"Mobile-Id Delivery Error",
		"MOBILE_ID_ERROR_DELIVERY_ERROR"
	],

	SIM_ERROR: [
		410,
		"Mobile-Id SIM Application Error",
		"MOBILE_ID_ERROR_SIM_ERROR"
	],
}

var SMART_ID_SESSION_ERRORS = {
	USER_REFUSED: [
		410,
		"Smart-Id Cancelled",
		"SMART_ID_ERROR_USER_REFUSED_SIGN"
	],

	TIMEOUT: [
		410,
		"Smart-Id Timeout",
		"SMART_ID_ERROR_TIMEOUT_SIGN"
	],

	DOCUMENT_UNUSABLE: [
		410,
		"Smart-Id Certificate Unusable",
		"SMART_ID_ERROR_DOCUMENT_UNUSABLE"
	],

	WRONG_VC: [
		410,
		"Wrong Smart-Id Verification Code Chosen",
		"SMART_ID_ERROR_WRONG_VERIFICATION_CODE"
	]
}

describe("SignaturesController", function() {
	require("root/test/web")()
	require("root/test/mitm")()
	require("root/test/db")()
	require("root/test/email")()
	require("root/test/fixtures").csrfRequest()
	beforeEach(require("root/test/mitm").router)
	
	describe(`GET / for ${ASICE_TYPE}`, function() {
		require("root/test/time")(new Date(2015, 5, 18))

		beforeEach(function*() {
			this.partner = yield createPartner(newPartner({id: Config.apiPartnerId}))
			this.author = yield createUser()
		})

		it("must respond with signature ASIC-E given parliament token",
			function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12)
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var signatures = _.sortBy(yield signaturesDb.create([
				new ValidSignature({initiative_uuid: initiative.uuid}),
				new ValidSignature({initiative_uuid: initiative.uuid})
			]), "personal_id")

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			path += "?parliament-token=" + initiative.parliament_token.toString("hex")
			var res = yield this.request(path)

			res.statusCode.must.equal(200)
			res.headers["content-type"].must.equal(ASICE_TYPE)
			var zip = yield parseZip(Buffer.from(res.body))
			var entries = yield parseZipEntries(zip)
			Object.keys(entries).length.must.equal(5)

			var body = initiative.text
			yield readZipEntry(zip, entries["initiative.html"]).must.then.equal(body)

			yield Promise.all([
				readZipEntry(zip, entries["META-INF/signatures-1.xml"]),
				readZipEntry(zip, entries["META-INF/signatures-2.xml"]),
			]).must.then.eql(_.map(signatures, "xades"))
		})

		it("must respond if no signatures", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12)
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			path += "?parliament-token=" + initiative.parliament_token.toString("hex")
			var res = yield this.request(path)

			res.statusCode.must.equal(200)
			res.headers["content-type"].must.equal(ASICE_TYPE)
			var zip = yield parseZip(Buffer.from(res.body))
			var entries = yield parseZipEntries(zip)
			Object.keys(entries).length.must.equal(3)

			var body = initiative.text
			yield readZipEntry(zip, entries["initiative.html"]).must.then.equal(body)
		})

		it("must respond with 403 Forbidden if no token on initiative",
			function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: null
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			path += "?parliament-token="
			var res = yield this.request(path)
			res.statusCode.must.equal(403)
			res.statusMessage.must.match(/not available/i)
		})

		it("must respond with 403 Forbidden given no token", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12)
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			var res = yield this.request(path)
			res.statusCode.must.equal(403)
			res.statusMessage.must.match(/invalid token/i)
		})

		it("must respond with 403 Forbidden given empty token", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12)
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			path += "?parliament-token="
			var res = yield this.request(path)
			res.statusCode.must.equal(403)
			res.statusMessage.must.match(/invalid token/i)
		})

		it("must respond with 403 Forbidden given invalid token", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12)
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			var res = yield this.request(path + "?parliament-token=deadbeef")
			res.statusCode.must.equal(403)
			res.statusMessage.must.match(/invalid token/i)
		})

		it("must respond with 403 Forbidden given non-hex token", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12)
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			var res = yield this.request(path + "?parliament-token=foobar")
			res.statusCode.must.equal(403)
			res.statusMessage.must.match(/invalid token/i)
		})

		it("must respond with 423 Locked if initiative received by parliament",
			function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				user_id: this.author.id,
				phase: "parliament",
				parliament_token: Crypto.randomBytes(12),
				received_by_parliament_at: new Date
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.author.uuid,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			var path = `/initiatives/${initiative.uuid}/signatures.asice`
			path += "?parliament-token=" + initiative.parliament_token.toString("hex")
			var res = yield this.request(path)
			res.statusCode.must.equal(423)
			res.statusMessage.must.match(/already in parliament/i)
		})
	})

	describe("POST /", function() {
		require("root/test/time")(new Date(2015, 5, 18))

		describe("when undersignable", function() {
			beforeEach(function*() {
				this.partner = yield createPartner(newPartner({
					id: Config.apiPartnerId
				}))

				this.author = yield createUser()

				this.initiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id,
					phase: "sign",
					undersignable: true
				}))

				this.topic = yield createTopic(newTopic({
					id: this.initiative.uuid,
					creatorId: this.author.uuid,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				this.vote = yield createVote(this.topic, newVote({
					endsAt: DateFns.addDays(new Date, 1)
				}))

				this.yesAndNo = yield createOptions(this.vote)
			})

			function mustSign(sign, certificate) {
				describe("as signable", function() {
					it("must create a signature given a non-ETSI semantic personal id",
						function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationName: "ESTEID",
								organizationalUnitName: "digital signature",
								commonName: `SMITH,JOHN,${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: PERSONAL_ID
							},

							issuer: VALID_ISSUERS[0],
							publicKey: JOHN_RSA_KEYS.publicKey
						}))

						var res = yield sign(
							this.router,
							this.request,
							this.initiative,
							cert
						)

						res.statusCode.must.equal(204)

						var signature = yield signaturesDb.read(sql`
							SELECT * FROM initiative_signatures
						`)

						signature.country.must.equal("EE")
						signature.personal_id.must.equal(PERSONAL_ID)
					})

					VALID_ISSUERS.forEach(function(issuer) {
						var issuerName = _.merge({}, ...issuer.subject).commonName

						it(`must create signature given certificate issued by ${issuerName}`,
							function*() {
							var cert = new Certificate(newCertificate({
								subject: {
									countryName: "EE",
									organizationName: "ESTEID",
									organizationalUnitName: "digital signature",
									commonName: `SMITH,JOHN,${PERSONAL_ID}`,
									surname: "SMITH",
									givenName: "JOHN",
									serialNumber: `PNOEE-${PERSONAL_ID}`
								},

								issuer: issuer,
								publicKey: JOHN_RSA_KEYS.publicKey
							}))

							var res = yield sign(
								this.router,
								this.request,
								this.initiative,
								cert
							)

							res.statusCode.must.equal(204)

							yield signaturesDb.search(sql`
								SELECT * FROM initiative_signatures
							`).must.then.not.be.empty()
						})
					})

					it("must thank after signing", function*() {
						var signed = yield sign(
							this.router,
							this.request,
							this.initiative,
							certificate
						)

						signed.statusCode.must.equal(204)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.not.include(this.yesAndNo[1])
					})

					it("must create a signature and thank after signing again",
						function*() {
						var oldSignature = yield signaturesDb.create(new ValidSignature({
							initiative_uuid: this.initiative.uuid,
							country: "EE",
							personal_id: PERSONAL_ID
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.initiative,
							certificate
						)

						signed.statusCode.must.equal(204)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.not.include(this.yesAndNo[1])

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.not.eql([oldSignature])
					})

					it("must create a signature and thank after signing if previously hidden", function*() {
						var oldSignature = yield signaturesDb.create(new ValidSignature({
							initiative_uuid: this.initiative.uuid,
							country: "EE",
							personal_id: PERSONAL_ID,
							hidden: true,

							xades: hades.new(MOBILE_ID_CERTIFICATE, [{
								path: this.initiative.text,
								type: this.initiative.text_type,
								hash: this.initiative.text_sha256
							}])
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.initiative,
							certificate
						)

						signed.statusCode.must.equal(204)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.not.include(this.yesAndNo[1])

						var signatures = yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`)

						signatures.length.must.equal(1)
						signatures[0].must.not.eql([oldSignature])
						signatures[0].hidden.must.be.false()
					})

					it("must not affect signature on another initiative", function*() {
						var otherInitiative = yield initiativesDb.create(
							new ValidInitiative({user_id: this.author.id, phase: "sign"})
						)

						yield signaturesDb.create(new ValidSignature({
							initiative_uuid: otherInitiative.uuid,
							country: "EE",
							personal_id: PERSONAL_ID
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.initiative,
							certificate
						)

						signed.statusCode.must.equal(204)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))

						var signatures = yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
							ORDER BY created_at
						`)

						signatures.length.must.equal(2)
					})

					it("must not affect signature of another user", function*() {
						yield signaturesDb.create(new ValidSignature({
							initiative_uuid: this.initiative.uuid,
							country: "EE",
							personal_id: "70001019906"
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.initiative,
							certificate
						)

						signed.statusCode.must.equal(204)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))

						var signatures = yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
							ORDER BY created_at
						`)

						signatures.length.must.equal(2)
					})

					it("must not affect signature of another country", function*() {
						yield signaturesDb.create(new ValidSignature({
							initiative_uuid: this.initiative.uuid,
							country: "LT",
							personal_id: PERSONAL_ID
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.initiative,
							certificate
						)

						signed.statusCode.must.equal(204)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))

						var signatures = yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
							ORDER BY created_at
						`)

						signatures.length.must.equal(2)
					})
				})
			}

			describe("when signing via Id-Card", function() {
				mustSign(signWithIdCard, ID_CARD_CERTIFICATE)

				it("must create a signature", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var path = `/initiatives/${this.initiative.uuid}`
					var signing = yield this.request(path + "/signatures", {
						method: "POST",
						headers: {Accept: SIGNABLE_TYPE, "Content-Type": CERTIFICATE_TYPE},
						body: cert.toBuffer()
					})

					signing.statusCode.must.equal(202)
					signing.headers["content-type"].must.equal(SIGNABLE_TYPE)

					var xades = hades.new(cert, [{
						path: "initiative.html",
						type: "text/html",
						hash: this.initiative.text_sha256
					}], {policy: "bdoc"})

					signing.body.must.eql(xades.signableHash)

					var signables = yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`)

					signables.length.must.equal(1)
					signables[0].initiative_uuid.must.equal(this.initiative.uuid)
					signables[0].country.must.equal("EE")
					signables[0].personal_id.must.equal(PERSONAL_ID)
					signables[0].method.must.equal("id-card")
					signables[0].xades.toString().must.equal(String(xades))
					signables[0].signed.must.be.false()
					signables[0].timestamped.must.be.false()
					demand(signables[0].error).be.null()

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.be.empty()

					var signatureBytes = signWithRsa(
						JOHN_RSA_KEYS.privateKey,
						xades.signable
					)

					xades.setSignature(signatureBytes)
					var ocspResponse = Ocsp.parse(newOcspResponse(cert))
					xades.setOcspResponse(ocspResponse)

					this.router.post(TIMEMARK_URL.path, function(req, res) {
						req.headers.host.must.equal(TIMEMARK_URL.host)
						res.setHeader("Content-Type", "application/ocsp-response")
						res.end(ocspResponse.toBuffer())
					})

					var signed = yield this.request(signing.headers.location, {
						method: "PUT",

						headers: {
							Accept: `application/x-empty, ${ERR_TYPE}`,
							"Content-Type": SIGNATURE_TYPE
						},

						body: signatureBytes
					})

					signed.statusCode.must.equal(204)
					signed.headers.location.must.equal(path)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.eql([new ValidSignature({
						initiative_uuid: this.initiative.uuid,
						token: signables[0].token,
						country: "EE",
						personal_id: PERSONAL_ID,
						method: "id-card",
						xades: String(xades)
					})])
				})

				it("must respond with 422 given certificate from untrusted issuer",
					function*() {
					var issuer = tsl.getBySubjectName([
						"C=EE",
						"O=AS Sertifitseerimiskeskus",
						"OU=Sertifitseerimisteenused",
						"CN=EID-SK 2007",
					].join(","))

					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						issuer: issuer,
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(`${initiativePath}/signatures`, {
						method: "POST",

						headers: {
							Accept: `${SIGNABLE_TYPE}, ${ERR_TYPE}`,
							"Content-Type": CERTIFICATE_TYPE
						},

						body: cert.toBuffer()
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Invalid Issuer")
					res.headers["content-type"].must.equal(ERR_TYPE)

					res.body.must.eql({
						code: 422,
						message: "Invalid Issuer",
						name: "HttpError",
						description: t("INVALID_CERTIFICATE_ISSUER")
					})
				})

				it("must respond with 422 given future certificate", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						validFrom: DateFns.addSeconds(new Date, 1),
						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(`${initiativePath}/signatures`, {
						method: "POST",

						headers: {
							Accept: `${SIGNABLE_TYPE}, ${ERR_TYPE}`,
							"Content-Type": CERTIFICATE_TYPE
						},

						body: cert.toBuffer()
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Certificate Not Yet Valid")
					res.headers["content-type"].must.equal(ERR_TYPE)

					res.body.must.eql({
						code: 422,
						message: "Certificate Not Yet Valid",
						name: "HttpError",
						description: t("CERTIFICATE_NOT_YET_VALID")
					})
				})

				it("must respond with 422 given past certificate", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						validUntil: new Date,
						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(`${initiativePath}/signatures`, {
						method: "POST",

						headers: {
							Accept: `${SIGNABLE_TYPE}, ${ERR_TYPE}`,
							"Content-Type": CERTIFICATE_TYPE
						},

						body: cert.toBuffer()
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Certificate Expired")
					res.headers["content-type"].must.equal(ERR_TYPE)

					res.body.must.eql({
						code: 422,
						message: "Certificate Expired",
						name: "HttpError",
						description: t("CERTIFICATE_EXPIRED")
					})
				})

				_.each({
					RSA: [JOHN_RSA_KEYS, signWithRsa],
					ECDSA: [JOHN_ECDSA_KEYS, signWithEcdsa]
				}, function([keys, sign], algo) {
					it(`must create a signature given an ${algo} signature`, function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationName: "ESTEID",
								organizationalUnitName: "digital signature",
								commonName: `SMITH,JOHN,${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: `PNOEE-${PERSONAL_ID}`
							},

							issuer: VALID_ISSUERS[0],
							publicKey: keys.publicKey
						}))

						var initiativePath = `/initiatives/${this.initiative.uuid}`
						var signing = yield this.request(`${initiativePath}/signatures`, {
							method: "POST",

							headers: {
								Accept: SIGNABLE_TYPE,
								"Content-Type": CERTIFICATE_TYPE
							},

							body: cert.toBuffer()
						})

						signing.statusCode.must.equal(202)

						var xades = yield signablesDb.read(sql`
							SELECT * FROM initiative_signables
							ORDER BY created_at DESC
							LIMIT 1
						`).then((row) => row.xades)

						this.router.post(TIMEMARK_URL.path, function(req, res) {
							req.headers.host.must.equal(TIMEMARK_URL.host)
							res.setHeader("Content-Type", "application/ocsp-response")
							res.end(Ocsp.parse(newOcspResponse(cert)).toBuffer())
						})

						var signed = yield this.request(signing.headers.location, {
							method: "PUT",

							headers: {
								Accept: `application/x-empty, ${ERR_TYPE}`,
								"Content-Type": SIGNATURE_TYPE
							},

							body: sign(keys.privateKey, xades.signable)
						})

						signed.statusCode.must.equal(204)
					})

					it(`must respond with 409 given an invalid ${algo} signature`,
						function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationName: "ESTEID",
								organizationalUnitName: "digital signature",
								commonName: `SMITH,JOHN,${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: `PNOEE-${PERSONAL_ID}`
							},

							issuer: VALID_ISSUERS[0],
							publicKey: keys.publicKey
						}))

						var initiativePath = `/initiatives/${this.initiative.uuid}`
						var signing = yield this.request(`${initiativePath}/signatures`, {
							method: "POST",

							headers: {
								Accept: SIGNABLE_TYPE,
								"Content-Type": CERTIFICATE_TYPE
							},

							body: cert.toBuffer()
						})

						signing.statusCode.must.equal(202)

						var res = yield this.request(signing.headers.location, {
							method: "PUT",

							headers: {
								Accept: `application/x-empty, ${ERR_TYPE}`,
								"Content-Type": SIGNATURE_TYPE
							},

							body: Crypto.randomBytes(64)
						})

						res.statusCode.must.equal(409)
						res.statusMessage.must.equal("Invalid Signature")
						res.headers["content-type"].must.equal(ERR_TYPE)

						res.body.must.eql({
							code: 409,
							message: "Invalid Signature",
							name: "HttpError"
						})

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.be.empty()
					})
				})
			})

			describe("when signing via Mobile-Id", function() {
				mustSign(signWithMobileId, MOBILE_ID_CERTIFICATE)

				it("must create a signature", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID (MOBIIL-ID)",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var xades = hades.new(cert, [{
						path: "initiative.html",
						type: "text/html",
						hash: this.initiative.text_sha256
					}], {policy: "bdoc"})

					var signatureBytes = signWithRsa(
						JOHN_RSA_KEYS.privateKey,
						xades.signable
					)

					xades.setSignature(signatureBytes)
					var ocspResponse = Ocsp.parse(newOcspResponse(cert))
					xades.setOcspResponse(ocspResponse)

					this.router.post(`${MOBILE_ID_URL.path}certificate`,
						function(req, res) {
						req.headers.host.must.equal(MOBILE_ID_URL.host)

						req.body.relyingPartyName.must.equal(Config.mobileIdUser)
						req.body.relyingPartyUUID.must.equal(Config.mobileIdPassword)
						req.body.phoneNumber.must.equal("+37200000766")
						req.body.nationalIdentityNumber.must.equal(PERSONAL_ID)

						respond({result: "OK", cert: cert.toString("base64")}, req, res)
					})

					this.router.post(`${MOBILE_ID_URL.path}signature`,
						function(req, res) {
						req.headers.host.must.equal(MOBILE_ID_URL.host)

						req.body.relyingPartyName.must.equal(Config.mobileIdUser)
						req.body.relyingPartyUUID.must.equal(Config.mobileIdPassword)
						req.body.phoneNumber.must.equal("+37200000766")
						req.body.nationalIdentityNumber.must.equal(PERSONAL_ID)
						req.body.hashType.must.equal("SHA256")
						req.body.hash.must.equal(xades.signableHash.toString("base64"))
						req.body.language.must.equal("EST")

						respond({sessionID: SESSION_ID}, req, res)
					})

					this.router.get(`${MOBILE_ID_URL.path}signature/session/:token`,
						function(req, res) {
						req.headers.host.must.equal(MOBILE_ID_URL.host)
						req.params.token.must.equal(SESSION_ID)

						respond({
							state: "COMPLETE",
							result: "OK",

							signature: {
								algorithm: "sha256WithRSAEncryption",
								value: signatureBytes.toString("base64")
							}
						}, req, res)
					})

					this.router.post(TIMEMARK_URL.path, function(req, res) {
						req.headers.host.must.equal(TIMEMARK_URL.host)
						res.setHeader("Content-Type", "application/ocsp-response")
						res.flushHeaders()

						// NOTE: Respond with a little delay to ensure signature
						// polling later works as expected.
						setTimeout(() => res.end(ocspResponse.toBuffer()), 100)
					})

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var signing = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: PERSONAL_ID,
							phoneNumber: "+37200000766"
						}
					})

					signing.statusCode.must.equal(202)

					var signed = yield this.request(signing.headers.location, {
						headers: {Accept: `application/x-empty, ${ERR_TYPE}`}
					})

					signed.statusCode.must.equal(204)
					signed.headers.location.must.equal(initiativePath)

					var signables = yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`)

					signables.length.must.equal(1)
					signables[0].initiative_uuid.must.equal(this.initiative.uuid)
					signables[0].country.must.equal("EE")
					signables[0].personal_id.must.equal(PERSONAL_ID)
					signables[0].method.must.equal("mobile-id")
					signables[0].xades.toString().must.equal(String(xades))
					signables[0].signed.must.be.true()
					signables[0].timestamped.must.be.true()
					demand(signables[0].error).be.null()

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.eql([new ValidSignature({
						initiative_uuid: this.initiative.uuid,
						token: signables[0].token,
						country: "EE",
						personal_id: PERSONAL_ID,
						method: "mobile-id",
						xades: String(xades)
					})])
				})

				it("must respond with 422 given certificate from untrusted issuer",
					function*() {
					var issuer = tsl.getBySubjectName([
						"C=EE",
						"O=AS Sertifitseerimiskeskus",
						"OU=Sertifitseerimisteenused",
						"CN=EID-SK 2007",
					].join(","))

					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID (MOBIIL-ID)",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						issuer: issuer,
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					this.router.post(
						`${MOBILE_ID_URL.path}certificate`,
						respond.bind(null, {result: "OK", cert: cert.toString("base64")})
					)

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: PERSONAL_ID,
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Invalid Issuer")
					res.headers["content-type"].must.equal("text/html; charset=utf-8")
					res.body.must.include(t("INVALID_CERTIFICATE_ISSUER"))
				})

				it("must respond with 422 given future certificate", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID (MOBIIL-ID)",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						validFrom: DateFns.addSeconds(new Date, 1),
						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					this.router.post(
						`${MOBILE_ID_URL.path}certificate`,
						respond.bind(null, {result: "OK", cert: cert.toString("base64")})
					)

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: PERSONAL_ID,
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Certificate Not Yet Valid")
					res.headers["content-type"].must.equal("text/html; charset=utf-8")
					res.body.must.include(t("CERTIFICATE_NOT_YET_VALID"))
				})

				it("must respond with 422 given past certificate", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationName: "ESTEID (MOBIIL-ID)",
							organizationalUnitName: "digital signature",
							commonName: `SMITH,JOHN,${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						validUntil: new Date,
						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					this.router.post(
						`${MOBILE_ID_URL.path}certificate`,
						respond.bind(null, {result: "OK", cert: cert.toString("base64")})
					)

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: PERSONAL_ID,
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Certificate Expired")
					res.headers["content-type"].must.equal("text/html; charset=utf-8")
					res.body.must.include(t("CERTIFICATE_EXPIRED"))
				})

				it("must create signature if Mobile-Id session running", function*() {
					var waited = 0
					var signed = yield signWithMobileId(
						this.router,
						this.request,
						this.initiative,
						MOBILE_ID_CERTIFICATE,
						next(function*(req, res) {
							if (waited++ < 2)
								return void respond({state: "RUNNING"}, req, res)

							res.writeHead(200)

							var xades = yield signablesDb.read(sql`
								SELECT * FROM initiative_signables
								ORDER BY created_at DESC
								LIMIT 1
							`).then((row) => row.xades)

							respond({
								state: "COMPLETE",
								result: "OK",

								signature: {
									algorithm: "sha256WithRSAEncryption",
									value: signWithRsa(
										JOHN_RSA_KEYS.privateKey,
										xades.signable
									).toString("base64")
								}
							}, req, res)
						})
					)

					signed.statusCode.must.equal(204)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.not.be.empty()

					var cookies = Http.parseCookies(signed.headers["set-cookie"])
					var res = yield this.request(signed.headers.location, {
						headers: {Cookie: Http.serializeCookies(cookies)}
					})

					res.statusCode.must.equal(200)
					res.body.must.include(t("THANKS_FOR_SIGNING"))
				})

				_.each({
					RSA: [JOHN_RSA_KEYS, signWithRsa],
					ECDSA: [JOHN_ECDSA_KEYS, signWithEcdsa]
				}, function([keys, sign], algo) {
					it(`must create a signature given an ${algo} signature`, function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationName: "ESTEID (MOBIIL-ID)",
								organizationalUnitName: "digital signature",
								commonName: `SMITH,JOHN,${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: `PNOEE-${PERSONAL_ID}`
							},

							issuer: VALID_ISSUERS[0],
							publicKey: keys.publicKey
						}))

						var signed = yield signWithMobileId(
							this.router,
							this.request,
							this.initiative,
							cert,
							next(function*(req, res) {
								res.writeHead(200)

								var xades = yield signablesDb.read(sql`
									SELECT * FROM initiative_signables
									ORDER BY created_at DESC
									LIMIT 1
								`).then((row) => row.xades)

								respond({
									state: "COMPLETE",
									result: "OK",

									signature: {
										algorithm: "sha256WithRSAEncryption",
										value: sign(
											keys.privateKey,
											xades.signable
										).toString("base64")
									}
								}, req, res)
							})
						)

						signed.statusCode.must.equal(204)

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.not.be.empty()
					})

					it(`must respond with error given an invalid ${algo} signature`,
						function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationName: "ESTEID (MOBIIL-ID)",
								organizationalUnitName: "digital signature",
								commonName: `SMITH,JOHN,${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: `PNOEE-${PERSONAL_ID}`
							},

							issuer: VALID_ISSUERS[0],
							publicKey: keys.publicKey
						}))

						var errored = yield signWithMobileId(
							this.router,
							this.request,
							this.initiative,
							cert,
							respond.bind(null, {
								state: "COMPLETE",
								result: "OK",

								signature: {
									algorithm: "sha256WithRSAEncryption",
									value: Crypto.randomBytes(64).toString("base64")
								}
							})
						)

						errored.statusCode.must.equal(410)
						errored.statusMessage.must.equal("Invalid Mobile-Id Signature")
						var initiativePath = `/initiatives/${this.initiative.uuid}`
						errored.headers.location.must.equal(initiativePath)

						var cookies = Http.parseCookies(errored.headers["set-cookie"])
						var res = yield this.request(errored.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.not.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("MOBILE_ID_ERROR_INVALID_SIGNATURE"))

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.be.empty()
					})
				})

				_.each(PHONE_NUMBER_TRANSFORMS, function(long, short) {
					it(`must transform mobile-id number ${short} to ${long}`,
						function*() {
						var created = 0
						this.router.post(`${MOBILE_ID_URL.path}certificate`, (req, res) => {
							++created
							req.body.phoneNumber.must.equal(long)
							req.body.nationalIdentityNumber.must.equal(PERSONAL_ID)
							respond({result: "NOT_FOUND"}, req, res)
						})

						var path = `/initiatives/${this.initiative.uuid}`
						var res = yield this.request(path + "/signatures", {
							method: "POST",
							form: {
								method: "mobile-id",
								personalId: PERSONAL_ID,
								phoneNumber: short
							}
						})

						created.must.equal(1)
						res.statusCode.must.equal(422)

						res.statusMessage.must.equal(
							"Not a Mobile-Id User or Personal Id Mismatch"
						)

						res.body.must.include(t("MOBILE_ID_ERROR_NOT_FOUND"))

						yield signablesDb.search(sql`
							SELECT * FROM initiative_signables
						`).must.then.be.empty()
					})
				})

				_.each(MOBILE_ID_CREATE_ERRORS,
					function([statusCode, statusMessage, error], code) {
					it(`must respond with error given ${code}`, function*() {
						this.router.post(
							`${MOBILE_ID_URL.path}certificate`,
							respond.bind(null, {result: code})
						)

						var path = `/initiatives/${this.initiative.uuid}`
						var res = yield this.request(path + "/signatures", {
							method: "POST",
							form: {
								method: "mobile-id",
								personalId: PERSONAL_ID,
								phoneNumber: "+37200000766"
							}
						})

						res.statusCode.must.equal(statusCode)
						res.statusMessage.must.equal(statusMessage)
						res.body.must.include(t(error))

						yield signablesDb.search(sql`
							SELECT * FROM initiative_signables
						`).must.then.be.empty()
					})
				})

				it("must respond with 422 given invalid personal id", function*() {
					this.router.post(`${MOBILE_ID_URL.path}certificate`,
						function(req, res) {
						res.statusCode = 400

						respond({
							error: "nationalIdentityNumber must contain of 11 digits"
						}, req, res)
					})

					var path = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(path + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: "60001010",
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal(
						"Not a Mobile-Id User or Personal Id Mismatch"
					)

					res.body.must.include(t("MOBILE_ID_ERROR_NOT_FOUND"))

					yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`).must.then.be.empty()
				})

				it("must respond with 422 given invalid phone number", function*() {
					this.router.post(`${MOBILE_ID_URL.path}certificate`,
						function(req, res) {
						res.statusCode = 400

						respond({
							error: "phoneNumber must contain of + and numbers(8-30)"
						}, req, res)
					})

					var path = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(path + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: "60001010",
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal(
						"Not a Mobile-Id User or Personal Id Mismatch"
					)

					res.body.must.include(t("MOBILE_ID_ERROR_NOT_FOUND"))

					yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`).must.then.be.empty()
				})

				it("must respond with 500 given Bad Request", function*() {
					this.router.post(`${MOBILE_ID_URL.path}certificate`,
						function(req, res) {
						res.statusCode = 400
						respond({error: "Unknown language 'FOOLANG"}, req, res)
					})

					var path = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(path + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							personalId: "60001010",
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(500)
					res.statusMessage.must.equal("Unknown Mobile-Id Error")
					res.body.must.not.include("FOOLANG")

					yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`).must.then.be.empty()
				})

				_.each(MOBILE_ID_SESSION_ERRORS,
					function([statusCode, statusMessage, error], code) {
					it(`must respond with error given ${code} while signing`,
						function*() {
						var errored = yield signWithMobileId(
							this.router,
							this.request,
							this.initiative,
							MOBILE_ID_CERTIFICATE,
							respond.bind(null, {state: "COMPLETE", result: code})
						)

						errored.statusCode.must.equal(statusCode)
						errored.statusMessage.must.equal(statusMessage)
						var initiativePath = `/initiatives/${this.initiative.uuid}`
						errored.headers.location.must.equal(initiativePath)

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.be.empty()

						var cookies = Http.parseCookies(errored.headers["set-cookie"])
						var res = yield this.request(errored.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.not.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t(error))
					})
				})

				it("must time out after 2 minutes", function*() {
					var waited = 0
					var errored = yield signWithMobileId(
						this.router,
						this.request,
						this.initiative,
						MOBILE_ID_CERTIFICATE,
						(req, res) => {
							Url.parse(req.url, true).query.timeoutMs.must.equal("30000")
							if (waited++ == 0) this.time.tick(119 * 1000)
							else this.time.tick(1000)
							respond({state: "RUNNING"}, req, res)
						}
					)

					errored.statusCode.must.equal(410)
					errored.statusMessage.must.equal("Mobile-Id Timeout")
					var initiativePath = `/initiatives/${this.initiative.uuid}`
					errored.headers.location.must.equal(initiativePath)
					waited.must.equal(2)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.be.empty()

					var cookies = Http.parseCookies(errored.headers["set-cookie"])
					var res = yield this.request(errored.headers.location, {
						headers: {Cookie: Http.serializeCookies(cookies)}
					})

					res.statusCode.must.equal(200)
					res.body.must.not.include(t("THANKS_FOR_SIGNING"))
					res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
					res.body.must.include(t("MOBILE_ID_ERROR_TIMEOUT"))
				})
			})

			describe("when signing via Smart-Id", function() {
				mustSign(signWithSmartId, SMART_ID_CERTIFICATE)

				it("must create a signature", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationalUnitName: "SIGNATURE",
							commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var xades = hades.new(cert, [{
						path: "initiative.html",
						type: "text/html",
						hash: this.initiative.text_sha256
					}], {policy: "bdoc"})

					var signatureBytes = signWithRsa(
						JOHN_RSA_KEYS.privateKey,
						xades.signable
					)

					xades.setSignature(signatureBytes)
					var ocspResponse = Ocsp.parse(newOcspResponse(cert))
					xades.setOcspResponse(ocspResponse)

					var certSession = "3befb011-37bf-4e57-b041-e4cba1496766"
					var signSession = "21e55f06-d6cb-40b7-9638-75dc0b131851"

					this.router.post(
						`${SMART_ID_URL.path}certificatechoice/etsi/PNOEE-${PERSONAL_ID}`,
						function(req, res) {
						req.headers.host.must.equal(SMART_ID_URL.host)

						req.body.relyingPartyName.must.equal(Config.smartIdUser)
						req.body.relyingPartyUUID.must.equal(Config.smartIdPassword)

						respond({sessionID: certSession}, req, res)
					})

					this.router.get(
						`${SMART_ID_URL.path}session/${certSession}`,
						function(req, res) {
						res.writeHead(200)
						req.headers.host.must.equal(SMART_ID_URL.host)

						respond({
							state: "COMPLETE",
							result: {endResult: "OK", documentNumber: SMART_ID},

							cert: {
								certificateLevel: "QUALIFIED",
								value: cert.toString("base64"),
							}
						}, req, res)
					})

					this.router.post(
						`${SMART_ID_URL.path}signature/document/${SMART_ID}`,
						function(req, res) {
						res.writeHead(200)
						req.headers.host.must.equal(SMART_ID_URL.host)

						req.body.relyingPartyName.must.equal(Config.smartIdUser)
						req.body.relyingPartyUUID.must.equal(Config.smartIdPassword)
						req.body.hashType.must.equal("SHA256")
						req.body.hash.must.equal(xades.signableHash.toString("base64"))

						respond({sessionID: signSession}, req, res)
					})

					this.router.get(`${SMART_ID_URL.path}session/${signSession}`,
						function(req, res) {
						res.writeHead(200)
						req.headers.host.must.equal(SMART_ID_URL.host)

						respond({
							state: "COMPLETE",
							result: {endResult: "OK"},

							cert: {
								certificateLevel: "QUALIFIED",
								value: cert.toString("base64"),
							},

							signature: {
								algorithm: "sha256WithRSAEncryption",
								value: signatureBytes.toString("base64")
							}
						}, req, res)
					})

					this.router.post(TIMEMARK_URL.path, function(req, res) {
						req.headers.host.must.equal(TIMEMARK_URL.host)
						res.setHeader("Content-Type", "application/ocsp-response")
						res.flushHeaders()

						// NOTE: Respond with a little delay to ensure signature
						// polling later works as expected.
						setTimeout(() => res.end(ocspResponse.toBuffer()), 100)
					})

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var signing = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {method: "smart-id", personalId: PERSONAL_ID}
					})

					signing.statusCode.must.equal(202)

					var signed = yield this.request(signing.headers.location, {
						headers: {Accept: `application/x-empty, ${ERR_TYPE}`}
					})

					signed.statusCode.must.equal(204)
					signed.headers.location.must.equal(initiativePath)

					var signables = yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`)

					signables.length.must.equal(1)
					signables[0].initiative_uuid.must.equal(this.initiative.uuid)
					signables[0].country.must.equal("EE")
					signables[0].personal_id.must.equal(PERSONAL_ID)
					signables[0].method.must.equal("smart-id")
					signables[0].xades.toString().must.equal(String(xades))
					signables[0].signed.must.be.true()
					signables[0].timestamped.must.be.true()
					demand(signables[0].error).be.null()

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.eql([new ValidSignature({
						initiative_uuid: this.initiative.uuid,
						token: signables[0].token,
						country: "EE",
						personal_id: PERSONAL_ID,
						method: "smart-id",
						xades: String(xades)
					})])
				})

				it("must respond with 422 given certificate from untrusted issuer",
					function*() {
					var issuer = tsl.getBySubjectName([
						"C=EE",
						"O=AS Sertifitseerimiskeskus",
						"OU=Sertifitseerimisteenused",
						"CN=EID-SK 2007",
					].join(","))

					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationalUnitName: "SIGNATURE",
							commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						issuer: issuer,
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var res = yield certWithSmartId(
						this.router,
						this.request,
						this.initiative,
						cert
					)

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Invalid Issuer")
					res.headers["content-type"].must.equal("text/html; charset=utf-8")
					res.body.must.include(t("INVALID_CERTIFICATE_ISSUER"))
				})

				it("must respond with 422 given future certificate", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationalUnitName: "SIGNATURE",
							commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						validFrom: DateFns.addSeconds(new Date, 1),
						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var res = yield certWithSmartId(
						this.router,
						this.request,
						this.initiative,
						cert
					)

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Certificate Not Yet Valid")
					res.headers["content-type"].must.equal("text/html; charset=utf-8")
					res.body.must.include(t("CERTIFICATE_NOT_YET_VALID"))
				})

				it("must respond with 422 given past certificate", function*() {
					var cert = new Certificate(newCertificate({
						subject: {
							countryName: "EE",
							organizationalUnitName: "SIGNATURE",
							commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
							surname: "SMITH",
							givenName: "JOHN",
							serialNumber: `PNOEE-${PERSONAL_ID}`
						},

						validUntil: new Date,
						issuer: VALID_ISSUERS[0],
						publicKey: JOHN_RSA_KEYS.publicKey
					}))

					var res = yield certWithSmartId(
						this.router,
						this.request,
						this.initiative,
						cert
					)

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Certificate Expired")
					res.headers["content-type"].must.equal("text/html; charset=utf-8")
					res.body.must.include(t("CERTIFICATE_EXPIRED"))
				})

				it("must create signature if Smart-Id session running", function*() {
					var waited = 0
					var signed = yield signWithSmartId(
						this.router,
						this.request,
						this.initiative,
						SMART_ID_CERTIFICATE,
						next(function*(req, res) {
							if (waited++ < 2)
								return void respond({state: "RUNNING"}, req, res)

							res.writeHead(200)

							var xades = yield signablesDb.read(sql`
								SELECT * FROM initiative_signables
								ORDER BY created_at DESC
								LIMIT 1
							`).then((row) => row.xades)

							respond({
								state: "COMPLETE",
								result: {endResult: "OK"},

								cert: {
									certificateLevel: "QUALIFIED",
									value: SMART_ID_CERTIFICATE.toString("base64")
								},

								signature: {
									algorithm: "sha256WithRSAEncryption",
									value: signWithRsa(
										JOHN_RSA_KEYS.privateKey,
										xades.signable
									).toString("base64")
								}
							}, req, res)
						})
					)

					signed.statusCode.must.equal(204)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.not.be.empty()

					var cookies = Http.parseCookies(signed.headers["set-cookie"])
					var res = yield this.request(signed.headers.location, {
						headers: {Cookie: Http.serializeCookies(cookies)}
					})

					res.statusCode.must.equal(200)
					res.body.must.include(t("THANKS_FOR_SIGNING"))
				})

				_.each({
					RSA: [JOHN_RSA_KEYS, signWithRsa],
					ECDSA: [JOHN_ECDSA_KEYS, signWithEcdsa]
				}, function([keys, sign], algo) {
					it(`must create a signature given an ${algo} signature`, function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationalUnitName: "SIGNATURE",
								commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: `PNOEE-${PERSONAL_ID}`
							},

							issuer: VALID_ISSUERS[0],
							publicKey: keys.publicKey
						}))

						var signed = yield signWithSmartId(
							this.router,
							this.request,
							this.initiative,
							cert,
							next(function*(req, res) {
								res.writeHead(200)

								var xades = yield signablesDb.read(sql`
									SELECT * FROM initiative_signables
									ORDER BY created_at DESC
									LIMIT 1
								`).then((row) => row.xades)

								respond({
									state: "COMPLETE",
									result: {endResult: "OK"},

									cert: {
										certificateLevel: "QUALIFIED",
										value: SMART_ID_CERTIFICATE.toString("base64")
									},

									signature: {
										algorithm: "sha256WithRSAEncryption",
										value: sign(
											keys.privateKey,
											xades.signable
										).toString("base64")
									}
								}, req, res)
							})
						)

						signed.statusCode.must.equal(204)

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.not.be.empty()
					})

					it(`must respond with error given an invalid ${algo} signature`,
						function*() {
						var cert = new Certificate(newCertificate({
							subject: {
								countryName: "EE",
								organizationalUnitName: "SIGNATURE",
								commonName: `SMITH,JOHN,PNOEE-${PERSONAL_ID}`,
								surname: "SMITH",
								givenName: "JOHN",
								serialNumber: `PNOEE-${PERSONAL_ID}`
							},

							issuer: VALID_ISSUERS[0],
							publicKey: keys.publicKey
						}))

						var errored = yield signWithSmartId(
							this.router,
							this.request,
							this.initiative,
							cert,
							respond.bind(null, {
								state: "COMPLETE",
								result: {endResult: "OK"},

								cert: {
									certificateLevel: "QUALIFIED",
									value: SMART_ID_CERTIFICATE.toString("base64")
								},

								signature: {
									algorithm: "sha256WithRSAEncryption",
									value: Crypto.randomBytes(64).toString("base64")
								}
							})
						)

						errored.statusCode.must.equal(410)
						errored.statusMessage.must.equal("Invalid Smart-Id Signature")
						var initiativePath = `/initiatives/${this.initiative.uuid}`
						errored.headers.location.must.equal(initiativePath)

						var cookies = Http.parseCookies(errored.headers["set-cookie"])
						var res = yield this.request(errored.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.not.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("SMART_ID_ERROR_INVALID_SIGNATURE"))

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.be.empty()
					})
				})

				it("must respond with 422 given invalid personal id", function*() {
					this.router.post(`${SMART_ID_URL.path}certificatechoice/etsi/:id`,
						function(req, res) {
						res.statusCode = 404
						respond({code: 404, message: "Not Found"}, req, res)
					})

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {method: "smart-id", personalId: "60001011337"}
					})

					res.statusCode.must.equal(422)
					res.statusMessage.must.equal("Not a Smart-Id User")
					res.body.must.include(t("SMART_ID_ERROR_NOT_FOUND"))

					yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`).must.then.be.empty()
				})

				it("must respond with 500 given Bad Request", function*() {
					this.router.post(`${SMART_ID_URL.path}certificatechoice/etsi/:id`,
						function(req, res) {
						res.statusCode = 400
						respond({code: 400, message: "Bad Request"}, req, res)
					})

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(initiativePath + "/signatures", {
						method: "POST",
						form: {method: "smart-id", personalId: "60001011337"}
					})

					res.statusCode.must.equal(500)
					res.statusMessage.must.equal("Unknown Smart-Id Error")
					res.body.must.not.include("FOOLANG")

					yield signablesDb.search(sql`
						SELECT * FROM initiative_signables
					`).must.then.be.empty()
				})

				_.each(SMART_ID_SESSION_ERRORS,
					function([statusCode, statusMessage, error], code) {
					it(`must respond with error given ${code} while fetching certificate`,
						function*() {
						var errored = yield certWithSmartId(
							this.router,
							this.request,
							this.initiative,
							respond.bind(null, {state: "COMPLETE", result: {endResult: code}})
						)

						errored.statusCode.must.equal(statusCode)
						errored.statusMessage.must.equal(statusMessage)
						errored.body.must.include(t(error))

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.be.empty()
					})

					it(`must respond with error given ${code} while signing`,
						function*() {
						var errored = yield signWithSmartId(
							this.router,
							this.request,
							this.initiative,
							SMART_ID_CERTIFICATE,
							respond.bind(null, {state: "COMPLETE", result: {endResult: code}})
						)

						errored.statusCode.must.equal(statusCode)
						errored.statusMessage.must.equal(statusMessage)
						var initiativePath = `/initiatives/${this.initiative.uuid}`
						errored.headers.location.must.equal(initiativePath)

						yield signaturesDb.search(sql`
							SELECT * FROM initiative_signatures
						`).must.then.be.empty()

						var cookies = Http.parseCookies(errored.headers["set-cookie"])
						var res = yield this.request(errored.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.not.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t(error))
					})
				})

				it("must time out after 2 minutes", function*() {
					var waited = 0
					var errored = yield signWithSmartId(
						this.router,
						this.request,
						this.initiative,
						SMART_ID_CERTIFICATE,
						(req, res) => {
							Url.parse(req.url, true).query.timeoutMs.must.equal("30000")
							if (waited++ == 0) this.time.tick(119 * 1000)
							else this.time.tick(1000)
							respond({state: "RUNNING"}, req, res)
						}
					)

					errored.statusCode.must.equal(410)
					errored.statusMessage.must.equal("Smart-Id Timeout")
					var initiativePath = `/initiatives/${this.initiative.uuid}`
					errored.headers.location.must.equal(initiativePath)
					waited.must.equal(2)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.be.empty()

					var cookies = Http.parseCookies(errored.headers["set-cookie"])
					var res = yield this.request(errored.headers.location, {
						headers: {Cookie: Http.serializeCookies(cookies)}
					})

					res.statusCode.must.equal(200)
					res.body.must.not.include(t("THANKS_FOR_SIGNING"))
					res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
					res.body.must.include(t("SMART_ID_ERROR_TIMEOUT_SIGN"))
				})
			})
		})

		describe("when CitizenOS-signable", function() {
			beforeEach(function*() {
				this.partner = yield createPartner(newPartner({
					id: Config.apiPartnerId
				}))

				this.author = yield createUser()

				this.initiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id,
					phase: "sign"
				}))

				this.topic = yield createTopic(newTopic({
					id: this.initiative.uuid,
					creatorId: this.author.uuid,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				this.vote = yield createVote(this.topic, newVote({
					endsAt: DateFns.addDays(new Date, 1)
				}))

				this.yesAndNo = yield createOptions(this.vote)
			})

			function mustSign(sign) {
				describe("as signable", function() {
					it("must thank after signing", function*() {
						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0]
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must thank after signing again", function*() {
						var user = yield createUser()

						yield createCitizenSignature(newSignature({
							userId: user.uuid,
							voteId: this.vote.id,
							optionId: this.yesAndNo[0],
							createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD)
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					// These occur only when signing with Mobile-Id as the signature
					// status endpoint of CitizenOS has the side-effect of creating the
					// signature and that could be called multiple times.
					it("must thank after signing with duplicate signatures", function*() {
						var user = yield createUser()

						yield createCitizenSignature(newSignature({
							userId: user.uuid,
							voteId: this.vote.id,
							optionId: this.yesAndNo[0],
							createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD + 1)
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must thank after signing again with duplicate signatures",
						function*() {
						var user = yield createUser()

						yield createCitizenSignature([
							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[0],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD)
							}),

							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[0],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD + 1)
							})
						])

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include(t("REVOKE_SIGNATURE"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must thank after signing after revoking earlier", function*() {
						var user = yield createUser()

						yield createCitizenSignature([
							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[0],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD * 2)
							}),

							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[1],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD)
							})
						])

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must thank after signing with duplicate signatures after revoking earlier", function*() {
						var user = yield createUser()

						yield createCitizenSignature([
							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[0],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD * 2)
							}),

							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[1],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD)
							}),

							newSignature({
								userId: user.uuid,
								voteId: this.vote.id,
								optionId: this.yesAndNo[0],
								createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD + 1)
							})
						])

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must thank after signing having signed another initiative",
						function*() {
						var user = yield createUser()

						var otherInitiative = yield initiativesDb.create(
							new ValidInitiative({user_id: this.author.id, phase: "sign"})
						)

						var otherTopic = yield createTopic(newTopic({
							id: otherInitiative.uuid,
							creatorId: this.author.uuid,
							sourcePartnerId: this.partner.id,
							status: "voting"
						}))

						var otherVote = yield createVote(otherTopic, newVote())

						yield createCitizenSignature(newSignature({
							userId: user.uuid,
							voteId: otherVote.id,
							optionId: this.yesAndNo[0],
							createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD)
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must thank after signing with another user signed", function*() {
						var user = yield createUser()

						yield createCitizenSignature(newSignature({
							userId: this.author.uuid,
							voteId: this.vote.id,
							optionId: this.yesAndNo[0],
							createdAt: DateFns.addSeconds(new Date, -NEW_SIG_TRESHOLD)
						}))

						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[0],
							user
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING_AGAIN"))
						res.body.must.include("donate-form")
						res.body.must.not.include(this.yesAndNo[0])
						res.body.must.include(this.yesAndNo[1])
					})

					it("must inform after deleting", function*() {
						var signed = yield sign(
							this.router,
							this.request,
							this.topic,
							this.vote,
							this.yesAndNo[1]
						)

						var cookies = Http.parseCookies(signed.headers["set-cookie"])
						var res = yield this.request(signed.headers.location, {
							headers: {Cookie: Http.serializeCookies(cookies)}
						})

						res.statusCode.must.equal(200)
						res.body.must.include(t("SIGNATURE_REVOKED"))
						res.body.must.not.include(t("THANKS_FOR_SIGNING"))
						res.body.must.not.include("donate-form")
						res.body.must.include(this.yesAndNo[0])
						res.body.must.not.include(this.yesAndNo[1])
					})
				})
			}

			describe("when signing via Id-Card", function() {
				it("must send signature to CitizenOS", function*() {
					var self = this
					var user = yield createUser()
					var signableHash = Crypto.randomBytes(32)

					this.router.post(`/api/topics/${this.topic.id}/votes/${this.vote.id}`,
						function(req, res) {
						req.body.must.eql({
							options: [{optionId: self.yesAndNo[0]}],
							certificate: ID_CARD_CERTIFICATE.toString("hex")
						})

						respond({data: {
							signedInfoHashType: "SHA-256",
							signedInfoDigest: signableHash.toString("hex"),
							token: AUTH_TOKEN
						}}, req, res)
					})

					var initiativePath = `/initiatives/${this.initiative.uuid}`
					var path = initiativePath + "/signatures?optionId=" + this.yesAndNo[0]
					var res = yield this.request(path, {
						method: "POST",

						headers: {
							Accept: SIGNABLE_TYPE,
							"Content-Type": CERTIFICATE_TYPE
						},

						body: ID_CARD_CERTIFICATE.toBuffer()
					})

					res.statusCode.must.equal(202)
					res.headers["content-type"].must.equal(SIGNABLE_TYPE)

					var signatureBytes = Crypto.randomBytes(64)

					this.router.post(
						`/api/topics/${this.topic.id}/votes/${this.vote.id}/sign`,
						next(function*(req, res) {
						req.body.must.eql({
							token: AUTH_TOKEN,
							signatureValue: signatureBytes.toString("hex")
						})

						var bdocUrl = newBdocUrl(self.topic, self.vote, user)
						respond({data: {bdocUri: bdocUrl}}, req, res)

						yield createCitizenSignature(newSignature({
							userId: user.uuid,
							voteId: self.vote.id,
							optionId: self.yesAndNo[0]
						}))
					}))

					var signed = yield this.request(res.headers.location, {
						method: "PUT",

						headers: {
							Accept: `application/x-empty, ${ERR_TYPE}`,
							"Content-Type": SIGNATURE_TYPE
						},

						body: signatureBytes
					})

					signed.statusCode.must.equal(204)
					signed.headers.location.must.equal(initiativePath)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.eql([])
				})

				mustSign(signWithIdCardViaCitizen)
			})

			describe("when signing via Mobile-Id", function() {
				it("must create a signature", function*() {
					var created = 0
					this.router.post(`/api/topics/${this.topic.id}/votes/${this.vote.id}`,
						function(req, res) {
						++created
						req.body.must.eql({
							options: [{optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0"}],
							pid: "11412090004",
							phoneNumber: "+37200000766",
						})

						respond({data: {challengeID: "1337", token: SIGN_TOKEN}}, req, res)
					})

					var path = `/initiatives/${this.initiative.uuid}`
					var res = yield this.request(path + "/signatures", {
						method: "POST",
						form: {
							method: "mobile-id",
							optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0",
							personalId: "11412090004",
							phoneNumber: "+37200000766"
						}
					})

					res.statusCode.must.equal(202)
					created.must.equal(1)

					var self = this
					var user = yield createUser()

					this.router.get(
						`/api/topics/${this.topic.id}/votes/${this.vote.id}/status`,
						next(function*(req, res) {
						var query = Url.parse(req.url, true).query
						query.token.must.equal(SIGN_TOKEN)
						var bdocUrl = newBdocUrl(self.topic, self.vote, user)
						respond({status: {code: 20000}, data: {bdocUri: bdocUrl}}, req, res)

						yield createCitizenSignature(newSignature({
							userId: user.uuid,
							voteId: self.vote.id,
							optionId: self.yesAndNo[0]
						}))
					}))

					var poll = yield this.request(res.headers.location, {
						headers: {Accept: `application/x-empty, ${ERR_TYPE}`}
					})

					poll.statusCode.must.equal(204)
					poll.headers.location.must.equal(path)

					yield signaturesDb.search(sql`
						SELECT * FROM initiative_signatures
					`).must.then.eql([])
				})

				mustSign(signWithMobileIdViaCitizen)

				_.each(PHONE_NUMBER_TRANSFORMS, function(long, short) {
					it(`must transform mobile-id number ${short} to ${long}`,
						function*() {
						var created = 0
						this.router.post(
							`/api/topics/${this.topic.id}/votes/${this.vote.id}`,
							function(req, res) {
							++created
							req.body.must.eql({
								options: [{optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0"}],
								pid: "11412090004",
								phoneNumber: long,
							})

							respond({data: {challengeID: "1337", token: "abcdef"}}, req, res)
						})

						var path = `/initiatives/${this.initiative.uuid}`
						var res = yield this.request(path + "/signatures", {
							method: "POST",
							form: {
								method: "mobile-id",
								optionId: "0bf34d36-59cd-438f-afd1-9a3a779b78b0",
								personalId: "11412090004",
								phoneNumber: short
							}
						})

						res.statusCode.must.equal(202)
						created.must.equal(1)
					})
				})
			})
		})
	})

	describe("PUT /:id", function() {
		require("root/test/time")()

		describe("when undersignable", function() {
			beforeEach(function*() {
				this.partner = yield createPartner(newPartner({
					id: Config.apiPartnerId
				}))

				this.author = yield createUser()

				this.initiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id,
					phase: "sign",
					undersignable: true
				}))

				this.topic = yield createTopic(newTopic({
					id: this.initiative.uuid,
					creatorId: this.author.uuid,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				this.vote = yield createVote(this.topic, newVote({
					endsAt: DateFns.addDays(new Date, 1)
				}))

				this.yesAndNo = yield createOptions(this.vote)
			})

			it("must hide signature and redirect", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				path += "?token=" + signature.token.toString("hex")
				var updated = yield this.request(path, {
					method: "PUT",
					form: {hidden: true}
				})

				updated.statusCode.must.equal(303)
				updated.headers.location.must.equal(initiativePath)

				yield signaturesDb.search(sql`
					SELECT * FROM initiative_signatures
				`).must.then.eql([{
					__proto__: signature,
					hidden: true,
					updated_at: new Date
				}])

				var cookies = Http.parseCookies(updated.headers["set-cookie"])
				var res = yield this.request(updated.headers.location, {
					headers: {Cookie: Http.serializeCookies(cookies)}
				})

				res.statusCode.must.equal(200)
				res.body.must.include(t("SIGNATURE_HIDDEN"))
			})

			it("must respond with 404 if no signature", function*() {
				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337?token=aabbccddee"
				var res = yield this.request(path, {
					method: "PUT",
					form: {hidden: true}
				})

				res.statusCode.must.equal(404)
			})

			it("must respond with 404 if invalid token", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337?token=aabbccddee"
				var res = yield this.request(path, {
					method: "PUT",
					form: {hidden: true}
				})

				res.statusCode.must.equal(404)
				yield signaturesDb.read(signature).must.then.eql(signature)
			})

			it("must respond with 409 if setting signature once signed", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				path += "?token=" + signature.token.toString("hex")
				var updated = yield this.request(path, {
					method: "PUT",
					headers: {"Content-Type": SIGNATURE_TYPE}
				})

				updated.statusCode.must.equal(409)
				updated.statusMessage.must.equal("Already Signed")
			})
		})

		describe("when CitizenOS-signable", function() {
			beforeEach(function*() {
				this.partner = yield createPartner(newPartner({
					id: Config.apiPartnerId
				}))

				this.author = yield createUser()

				this.initiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id,
					phase: "sign"
				}))

				this.topic = yield createTopic(newTopic({
					id: this.initiative.uuid,
					creatorId: this.author.uuid,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				this.vote = yield createVote(this.topic, newVote({
					endsAt: DateFns.addDays(new Date, 1)
				}))

				this.yesAndNo = yield createOptions(this.vote)
			})

			it("must respond with 405 Method Not Allowed", function*() {
				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				var res = yield this.request(path, {method: "PUT"})
				res.statusCode.must.equal(405)
			})
		})
	})

	describe("DELETE /:id", function() {
		describe("when undersignable", function() {
			beforeEach(function*() {
				this.partner = yield createPartner(newPartner({
					id: Config.apiPartnerId
				}))

				this.author = yield createUser()

				this.initiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id,
					phase: "sign",
					undersignable: true
				}))

				this.topic = yield createTopic(newTopic({
					id: this.initiative.uuid,
					creatorId: this.author.uuid,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				this.vote = yield createVote(this.topic, newVote({
					endsAt: DateFns.addDays(new Date, 1)
				}))

				this.yesAndNo = yield createOptions(this.vote)
			})

			it("must delete signature and redirect", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				path += "?token=" + signature.token.toString("hex")
				var deleted = yield this.request(path, {method: "DELETE"})
				deleted.statusCode.must.equal(303)
				deleted.headers.location.must.equal(initiativePath)

				yield signaturesDb.search(sql`
					SELECT * FROM initiative_signatures
				`).must.then.be.empty()

				var cookies = Http.parseCookies(deleted.headers["set-cookie"])
				var res = yield this.request(deleted.headers.location, {
					headers: {Cookie: Http.serializeCookies(cookies)}
				})

				res.statusCode.must.equal(200)
				res.body.must.include(t("SIGNATURE_REVOKED"))
				res.body.must.not.include(t("THANKS_FOR_SIGNING"))
				res.body.must.not.include("donate-form")
				res.body.must.include(this.yesAndNo[0])
				res.body.must.not.include(this.yesAndNo[1])
			})

			it("must respond with 404 if no signature", function*() {
				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337?token=aabbccddee"
				var res = yield this.request(path, {method: "DELETE"})
				res.statusCode.must.equal(404)
			})

			it("must respond with 404 if invalid token", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337?token=aabbccddee"
				var res = yield this.request(path, {method: "DELETE"})

				res.statusCode.must.equal(404)
				yield signaturesDb.read(signature).must.then.eql(signature)
			})

			it("must not delete signature on another initiative", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var otherInitiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id
				}))

				var otherSignature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: otherInitiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				path += "?token=" + signature.token.toString("hex")
				var res = yield this.request(path, {method: "DELETE"})
				res.statusCode.must.equal(303)

				yield signaturesDb.search(sql`
					SELECT * FROM initiative_signatures
				`).must.then.eql([otherSignature])
			})

			it("must not delete signature of another person", function*() {
				var signature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "38706181337"
				}))

				var otherSignature = yield signaturesDb.create(new ValidSignature({
					initiative_uuid: this.initiative.uuid,
					country: "EE",
					personal_id: "60001019907"
				}))

				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				path += "?token=" + signature.token.toString("hex")
				var res = yield this.request(path, {method: "DELETE"})
				res.statusCode.must.equal(303)

				yield signaturesDb.search(sql`
					SELECT * FROM initiative_signatures
				`).must.then.eql([otherSignature])
			})
		})
		
		describe("when CitizenOS-signable", function() {
			beforeEach(function*() {
				this.partner = yield createPartner(newPartner({
					id: Config.apiPartnerId
				}))

				this.author = yield createUser()

				this.initiative = yield initiativesDb.create(new ValidInitiative({
					user_id: this.author.id,
					phase: "sign"
				}))

				this.topic = yield createTopic(newTopic({
					id: this.initiative.uuid,
					creatorId: this.author.uuid,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				this.vote = yield createVote(this.topic, newVote({
					endsAt: DateFns.addDays(new Date, 1)
				}))

				this.yesAndNo = yield createOptions(this.vote)
			})

			it("must respond with 405 Method Not Allowed", function*() {
				var initiativePath = `/initiatives/${this.initiative.uuid}`
				var path = initiativePath + "/signatures/EE38706181337"
				var res = yield this.request(path, {method: "DELETE"})
				res.statusCode.must.equal(405)
			})
		})
	})
})

function* signWithIdCard(router, request, initiative, cert) {
	var signing = yield request(`/initiatives/${initiative.uuid}/signatures`, {
		method: "POST",
		headers: {Accept: SIGNABLE_TYPE, "Content-Type": CERTIFICATE_TYPE},
		body: cert.toBuffer()
	})

	signing.statusCode.must.equal(202)

	var xades = yield signablesDb.read(sql`
		SELECT * FROM initiative_signables
		ORDER BY created_at DESC
		LIMIT 1
	`).then((row) => row.xades)

	router.post(TIMEMARK_URL.path, function(req, res) {
		req.headers.host.must.equal(TIMEMARK_URL.host)
		res.setHeader("Content-Type", "application/ocsp-response")
		res.end(Ocsp.parse(newOcspResponse(cert)).toBuffer())
	})

	return request(signing.headers.location, {
		method: "PUT",
		headers: {
			Accept: `application/x-empty, ${ERR_TYPE}`,
			"Content-Type": SIGNATURE_TYPE
		},

		body: signWithRsa(JOHN_RSA_KEYS.privateKey, xades.signable)
	})
}

function* signWithMobileId(router, request, initiative, cert, res) {
	router.post(`${MOBILE_ID_URL.path}certificate`, function(req, res) {
		respond({result: "OK", cert: cert.toString("base64")}, req, res)
	})

	router.post(`${MOBILE_ID_URL.path}signature`, function(req, res) {
		respond({sessionID: "7c8bdd56-6772-4264-ba27-bf7a9ef72a11"}, req, res)
	})

	router.get(
		`${MOBILE_ID_URL.path}signature/session/:token`,
		typeof res == "function" ? res : next(function*(req, res) {
			res.writeHead(200)

			var xades = yield signablesDb.read(sql`
				SELECT xades FROM initiative_signables
				ORDER BY created_at DESC
				LIMIT 1
			`).then((row) => row.xades)

			respond({
				state: "COMPLETE",
				result: "OK",

				signature: {
					algorithm: "sha256WithRSAEncryption",
					value: signWithRsa(
						JOHN_RSA_KEYS.privateKey,
						xades.signable
					).toString("base64")
				}
			}, req, res)
		})
	)

	router.post(TIMEMARK_URL.path, function(req, res) {
		req.headers.host.must.equal(TIMEMARK_URL.host)
		res.setHeader("Content-Type", "application/ocsp-response")
		res.end(Ocsp.parse(newOcspResponse(cert)).toBuffer())
	})

	var signing = yield request(`/initiatives/${initiative.uuid}/signatures`, {
		method: "POST",
		form: {
			method: "mobile-id",
			personalId: PERSONAL_ID,
			phoneNumber: "+37200000766"
		}
	})

	signing.statusCode.must.equal(202)

	return request(signing.headers.location, {
		headers: {Accept: `application/x-empty, ${ERR_TYPE}`}
	})
}

function certWithSmartId(router, request, initiative, cert) {
	var certSession = "3befb011-37bf-4e57-b041-e4cba1496766"

	router.post(
		`${SMART_ID_URL.path}certificatechoice/etsi/:id`,
		respond.bind(null, {sessionID: certSession})
	)

	router.get(
		`${SMART_ID_URL.path}session/${certSession}`,
		typeof cert == "function" ? cert : respond.bind(null, {
			state: "COMPLETE",
			result: {endResult: "OK", documentNumber: SMART_ID},
			cert: {certificateLevel: "QUALIFIED", value: cert.toString("base64")}
		})
	)

	return request(`/initiatives/${initiative.uuid}/signatures`, {
		method: "POST",
		form: {method: "smart-id", personalId: PERSONAL_ID}
	})
}

function* signWithSmartId(router, request, initiative, cert, res) {
	var signSession = "21e55f06-d6cb-40b7-9638-75dc0b131851"

	router.post(
		`${SMART_ID_URL.path}signature/document/${SMART_ID}`,
		respond.bind(null, {sessionID: signSession})
	)

	router.get(
		`${SMART_ID_URL.path}session/${signSession}`,
		typeof res == "function" ? res : next(function*(req, res) {
			res.writeHead(200)

			var xades = yield signablesDb.read(sql`
				SELECT xades FROM initiative_signables
				ORDER BY created_at DESC
				LIMIT 1
			`).then((row) => row.xades)

			respond({
				state: "COMPLETE",
				result: {endResult: "OK"},
				cert: {certificateLevel: "QUALIFIED", value: cert.toString("base64")},

				signature: {
					algorithm: "sha256WithRSAEncryption",
					value: signWithRsa(
						JOHN_RSA_KEYS.privateKey,
						xades.signable
					).toString("base64")
				}
			}, req, res)
		})
	)

	router.post(TIMEMARK_URL.path, function(req, res) {
		req.headers.host.must.equal(TIMEMARK_URL.host)
		res.setHeader("Content-Type", "application/ocsp-response")
		res.end(Ocsp.parse(newOcspResponse(cert)).toBuffer())
	})

	var signing = yield certWithSmartId(router, request, initiative, cert)
	signing.statusCode.must.equal(202)

	return request(signing.headers.location, {
		headers: {Accept: `application/x-empty, ${ERR_TYPE}`}
	})
}

function* signWithIdCardViaCitizen(router, request, topic, vote, optId, user) {
	if (user == null) user = yield createUser()
	var cert = ID_CARD_CERTIFICATE

	var signableHash = Crypto.randomBytes(32)

	router.post(`/api/topics/${topic.id}/votes/${vote.id}`, function(req, res) {
		req.body.must.eql({
			options: [{optionId: optId}],
			certificate: cert.toString("hex")
		})

		respond({data: {
			signedInfoHashType: "SHA-256",
			signedInfoDigest: signableHash.toString("hex"),
			token: AUTH_TOKEN
		}}, req, res)
	})

	var initiativePath = `/initiatives/${topic.id}`
	var path = initiativePath + "/signatures?optionId=" + optId
	var res = yield request(path, {
		method: "POST",
		headers: {Accept: SIGNABLE_TYPE, "Content-Type": CERTIFICATE_TYPE},
		body: cert.toBuffer()
	})

	res.statusCode.must.equal(202)

	router.post(
		`/api/topics/${topic.id}/votes/${vote.id}/sign`,
		next(function*(req, res) {
		respond({data: {bdocUri: newBdocUrl(topic, vote, user)}}, req, res)

		yield createCitizenSignature(newSignature({
			userId: user.uuid,
			voteId: vote.id,
			optionId: optId
		}))
	}))

	var signed = yield request(res.headers.location, {
		method: "PUT",
		headers: {"Content-Type": SIGNATURE_TYPE},
		body: Crypto.randomBytes(64)
	})

	signed.statusCode.must.equal(303)
	return signed
}

function* signWithMobileIdViaCitizen(
	router,
	request,
	topic,
	vote,
	optId,
	user
) {
	if (user == null) user = yield createUser()

	router.post(`/api/topics/${topic.id}/votes/${vote.id}`,
		function(req, res) {
		respond({data: {challengeID: "1337", token: SIGN_TOKEN}}, req, res)
	})

	var res = yield request(`/initiatives/${topic.id}/signatures`, {
		method: "POST",
		form: {
			method: "mobile-id",
			optionId: optId,
			personalId: "11412090004",
			phoneNumber: "+37200000766"
		}
	})

	res.statusCode.must.equal(202)

	router.get(`/api/topics/${topic.id}/votes/${vote.id}/status`,
		next(function*(req, res) {
		var bdocUrl = newBdocUrl(topic, vote, user)
		respond({status: {code: 20000}, data: {bdocUri: bdocUrl}}, req, res)

		yield createCitizenSignature(newSignature({
			createdAt: new Date,
			userId: user.uuid,
			voteId: vote.id,
			optionId: optId
		}))
	}))

	var signed = yield request(res.headers.location)
	signed.statusCode.must.equal(303)
	return signed
}

function newBdocUrl(topic, vote, user) {
	var url = "http://example.com/api/users/self/topics/" + topic.id
	url += `/votes/${vote.id}/downloads/bdocs/user`
	url += "?token=" + fakeJwt({userId: _.serializeUuid(user.uuid)})
	return url
}

function parseZipEntries(zip) {
	var entries = {}
	zip.on("entry", (entry) => (entries[entry.fileName] = entry))

	return new Promise(function(resolve, reject) {
		zip.on("error", reject)
		zip.on("end", resolve.bind(null, entries))
	})
}

function readZipEntry(zip, entry) {
	return new Promise(function(resolve, reject) {
		zip.openReadStream(entry, (err, stream) => (
			err ? reject(err) : resolve(slurp(stream, "utf8"))
		))
	})
}

function fakeJwt(obj) {
	var header = encodeBase64(JSON.stringify({typ: "JWT", alg: "RS256"}))
	var body = encodeBase64(JSON.stringify(obj))
	return header + "." + body + ".fakesignature"
}

function signWithRsa(key, signable) {
	return Crypto.createSign("sha256").update(signable).sign(key)
}

function signWithEcdsa(key, signable) {
	var signatureDer = Crypto.createSign("sha256").update(signable).sign(key)
	var signatureAsn = X509Asn.EcSignature.decode(signatureDer)

	return Buffer.concat([
		signatureAsn.r.toBuffer("be", 32),
		signatureAsn.s.toBuffer("be", 32)
	])
}

function* parseZip(buffer) { return yield Yauzl.fromBuffer.bind(null, buffer) }
