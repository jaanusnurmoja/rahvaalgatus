var _ = require("root/lib/underscore")
var Config = require("root/config")
var DateFns = require("date-fns")
var ValidInitiative = require("root/test/valid_db_initiative")
var ValidSignature = require("root/test/valid_signature")
var newPartner = require("root/test/citizenos_fixtures").newPartner
var newUser = require("root/test/citizenos_fixtures").newUser
var newTopic = require("root/test/citizenos_fixtures").newTopic
var newVote = require("root/test/citizenos_fixtures").newVote
var createPartner = require("root/test/citizenos_fixtures").createPartner
var createUser = require("root/test/citizenos_fixtures").createUser
var createTopic = require("root/test/citizenos_fixtures").createTopic
var createVote = require("root/test/citizenos_fixtures").createVote
var createSignatures = require("root/test/citizenos_fixtures").createSignatures
var initiativesDb = require("root/db/initiatives_db")
var signaturesDb = require("root/db/initiative_signatures_db")
var parseDom = require("root/lib/dom").parse
var STATISTICS_TYPE = "application/vnd.rahvaalgatus.statistics+json; v=1"
var PHASES = require("root/lib/initiative").PHASES

var PHASE_TO_STATUS = {
	sign: "voting",
	parliament: "followUp",
	government: "followUp",
	done: "followUp"
}

var EMPTY_STATISTICS = {
	initiativeCountsByPhase: {
		edit: 0,
		sign: 0,
		parliament: 0,
		government: 0,
		done: 0
	},

	signatureCount: 0
}

describe("HomeController", function() {
	require("root/test/web")()
	require("root/test/mitm")()
	require("root/test/db")()
	require("root/test/time")()
	beforeEach(require("root/test/mitm").router)

	beforeEach(function*() {
		this.user = yield createUser(newUser())
		this.partner = yield createPartner(newPartner({id: Config.apiPartnerId}))
	})

	describe("GET /", function() {
		it("must show initiatives in edit phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "edit"
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				endsAt: DateFns.addSeconds(new Date, 1),
				visibility: "public"
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show initiatives in edit phase that have ended less than 2w ago",
			function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "edit"
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				visibility: "public",
				endsAt: DateFns.addDays(DateFns.startOfDay(new Date), -13)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must not show initiatives in edit phase that have ended", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "edit"
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				visibility: "public",
				endsAt: DateFns.addDays(DateFns.startOfDay(new Date), -14)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(initiative.uuid)
		})

		it("must not show archived initiatives in edit phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "edit",
				archived_at: new Date
			}))

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				visibility: "public",
				endsAt: DateFns.addSeconds(new Date, 1)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(initiative.uuid)
		})

		it("must show initiatives in sign phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "sign"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "voting"
			}))

			yield createVote(topic, newVote({
				endsAt: DateFns.addSeconds(new Date, 1)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show initiatives in sign phase that failed in less than 2w",
			function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "sign"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "voting"
			}))

			yield createVote(topic, newVote({
				endsAt: DateFns.addDays(DateFns.startOfDay(new Date), -13)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must not show initiatives in sign phase that failed", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "sign"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "voting"
			}))

			yield createVote(topic, newVote({
				endsAt: DateFns.addDays(DateFns.startOfDay(new Date), -14)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(initiative.uuid)
		})

		it("must show initiatives in sign phase that succeeded", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "sign"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "voting"
			}))

			var vote = yield createVote(topic, newVote({
				endsAt: DateFns.addDays(DateFns.startOfDay(new Date), -14)
			}))

			yield createSignatures(vote, Config.votesRequired)

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show initiatives in parliament phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "parliament"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			yield createVote(topic, newVote())

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show external initiatives in parliament phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "parliament",
				external: true
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show initiatives in government phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "government"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			yield createVote(topic, newVote())

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show external initiatives in government phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "government",
				external: true
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show initiatives in done phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "done"
			}))

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "followUp"
			}))

			yield createVote(topic, newVote())

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must show external initiatives in done phase", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "done",
				external: true
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.include(initiative.uuid)
		})

		it("must not show archived external initiatives in done phase",
			function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative({
				phase: "done",
				external: true,
				archived_at: new Date
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(initiative.uuid)
		})

		_.each(Config.partners, function(partner, id) {
			if (id == Config.apiPartnerId) return

			describe("given " + partner.name, function() {
				it("must show initiatives", function*() {
					var initiative = yield initiativesDb.create(new ValidInitiative)
					var partner = yield createPartner(newPartner({id: id}))

					var topic = yield createTopic(newTopic({
						id: initiative.uuid,
						creatorId: this.user.id,
						sourcePartnerId: partner.id,
						visibility: "public",
						endsAt: DateFns.addSeconds(new Date, 1)
					}))

					var res = yield this.request("/")
					res.statusCode.must.equal(200)
					res.body.must.include(topic.id)
				})
			})
		})

		it("must not show initiatives from other partners", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative)
			var partner = yield createPartner(newPartner())

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: partner.id,
				visibility: "public",
				endsAt: DateFns.addSeconds(new Date, 1)
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(topic.id)
		})

		it("must not show private initiatives", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative)

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				endsAt: DateFns.addSeconds(new Date, 1),
				visibility: "private"
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(topic.id)
		})

		it("must not show deleted initiatives", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative)

			var topic = yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				visibility: "public",
				endsAt: DateFns.addSeconds(new Date, 1),
				deletedAt: new Date
			}))

			var res = yield this.request("/")
			res.statusCode.must.equal(200)
			res.body.must.not.include(topic.id)
		})

		it("must include social media tags", function*() {
			var res = yield this.request("/")
			res.statusCode.must.equal(200)

			var dom = parseDom(res.body)
			var metas = dom.head.querySelectorAll("meta")
			var metasByName = _.indexBy(metas, (el) => el.getAttribute("name"))
			var metasByProp = _.indexBy(metas, (el) => el.getAttribute("property"))

			metasByName["twitter:site"].content.must.equal("rahvaalgatus")
			metasByName["twitter:card"].content.must.equal("summary")

			metasByProp["og:title"].content.must.equal("Rahvaalgatus")
			var imageUrl = `${Config.url}/assets/rahvaalgatus-description.png`
			metasByProp["og:image"].content.must.equal(imageUrl)
		})

		describe("statistics", function() {
			it("must show signature count", function*() {
				var initiativeA = yield initiativesDb.create(new ValidInitiative({
					phase: "sign"
				}))

				var topic = yield createTopic(newTopic({
					id: initiativeA.uuid,
					creatorId: this.user.id,
					sourcePartnerId: this.partner.id,
					status: "voting"
				}))

				var vote = yield createVote(topic, newVote({endsAt: new Date}))
				yield createSignatures(vote, 5)

				var initiativeB = yield initiativesDb.create(new ValidInitiative({
					phase: "sign"
				}))

				yield signaturesDb.create(_.times(3, () => new ValidSignature({
					initiative_uuid: initiativeB.uuid
				})))

				var res = yield this.request("/")
				res.statusCode.must.equal(200)

				var dom = parseDom(res.body)
				var el = dom.querySelector("#signatures-statistic .count")
				el.textContent.must.equal("8")
			})
		})
	})

	describe(`GET /statistics with ${STATISTICS_TYPE}`, function() {
		it("must respond with JSON", function*() {
			var res = yield this.request("/statistics", {
				headers: {Accept: STATISTICS_TYPE}
			})

			res.statusCode.must.equal(200)
			res.headers["content-type"].must.equal(STATISTICS_TYPE)
			res.headers["access-control-allow-origin"].must.equal("*")
			res.body.must.eql(EMPTY_STATISTICS)
		})

		it("must respond with signature count", function*() {
			var initiativeA = yield initiativesDb.create(new ValidInitiative({
				phase: "sign"
			}))

			var topic = yield createTopic(newTopic({
				id: initiativeA.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "voting"
			}))

			var vote = yield createVote(topic, newVote({endsAt: new Date}))
			yield createSignatures(vote, 5)

			var initiativeB = yield initiativesDb.create(new ValidInitiative({
				phase: "sign"
			}))

			yield signaturesDb.create(_.times(3, () => new ValidSignature({
				initiative_uuid: initiativeB.uuid
			})))

			var res = yield this.request("/statistics", {
				headers: {Accept: STATISTICS_TYPE}
			})

			res.statusCode.must.equal(200)
			res.body.signatureCount.must.equal(8)
		})

		PHASES.forEach(function(phase) {
			it(`must count initiatives in ${phase}`, function*() {
				var initiatives = yield initiativesDb.create(_.times(3, () => (
					new ValidInitiative({phase: phase}
				))))

				yield createTopic(initiatives.map((i) => newTopic({
					id: i.uuid,
					creatorId: this.user.id,
					sourcePartnerId: this.partner.id,
					visibility: "public",
					status: PHASE_TO_STATUS[phase]
				})))

				var res = yield this.request("/statistics", {
					headers: {Accept: STATISTICS_TYPE}
				})

				res.statusCode.must.equal(200)
				res.body.initiativeCountsByPhase[phase].must.equal(3)
			})
		})

		it("must not count external initiatives", function*() {
			yield initiativesDb.create(new ValidInitiative({
				phase: "parliament",
				external: true
			}))

			var res = yield this.request("/statistics", {
				headers: {Accept: STATISTICS_TYPE}
			})

			res.statusCode.must.equal(200)
			res.body.must.eql(EMPTY_STATISTICS)
		})

		it("must not count private topics", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative)

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				status: "inProgress"
			}))

			var res = yield this.request("/statistics", {
				headers: {Accept: STATISTICS_TYPE}
			})

			res.statusCode.must.equal(200)
			res.body.must.eql(EMPTY_STATISTICS)
		})

		it("must not count deleted topics", function*() {
			var initiative = yield initiativesDb.create(new ValidInitiative)

			yield createTopic(newTopic({
				id: initiative.uuid,
				creatorId: this.user.id,
				sourcePartnerId: this.partner.id,
				visibility: "public",
				status: "inProgress",
				deletedAt: new Date
			}))

			var res = yield this.request("/statistics", {
				headers: {Accept: STATISTICS_TYPE}
			})

			res.statusCode.must.equal(200)
			res.body.must.eql(EMPTY_STATISTICS)
		})
	})
})
