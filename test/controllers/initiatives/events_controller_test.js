var _ = require("root/lib/underscore")
var Config = require("root/config")
var ValidSubscription = require("root/test/valid_db_initiative_subscription")
var subscriptionsDb = require("root/db/initiative_subscriptions_db")
var eventsDb = require("root/db/initiative_events_db")
var messagesDb = require("root/db/initiative_messages_db")
var respond = require("root/test/fixtures").respond
var t = require("root/lib/i18n").t.bind(null, "et")
var renderEmail = require("root/lib/i18n").email.bind(null, "et")
var sql = require("sqlate")
var PARTNER_ID = Config.apiPartnerId
var UUID = "5f9a82a5-e815-440b-abe9-d17311b0b366"

var INITIATIVE = {
	id: UUID,
	createdAt: new Date(2000, 0, 1),
	sourcePartnerId: PARTNER_ID,
	status: "voting",
	title: "My thoughts",
	description: "<body><h1>My thoughts</h1></body>",
	creator: {name: "John"},
	visibility: "public",
	permission: {level: "read"},

	vote: {
		id: "396b0e5b-cca7-4255-9238-19b464e60b65",
		endsAt: new Date(3000, 0, 1),
		options: {rows: [{value: "Yes", voteCount: 0}]}
	}
}

var EDITABLE_INITIATIVE = _.assign({}, INITIATIVE, {
	permission: {level: "admin"}
})

describe("EventsController", function() {
	require("root/test/web")()
	require("root/test/mitm")()
	require("root/test/db")()
	require("root/test/email")()
	require("root/test/time")(Date.UTC(2015, 5, 18))
	beforeEach(require("root/test/mitm").router)
	
	describe("GET /new", function() {
		describe("when not logged in", function() {
			it("must respond with 401", function*() {
				this.router.get(`/api/topics/${UUID}`,
					respond.bind(null, {data: INITIATIVE}))

				var res = yield this.request(`/initiatives/${UUID}/events/new`)
				res.statusCode.must.equal(401)
			})
		})

		describe("when logged in", function() {
			require("root/test/fixtures").user()

			;["voting", "followUp"].forEach(function(status) {
				it("must render if " + status, function*() {
					this.router.get(`/api/users/self/topics/${UUID}`,
						respond.bind(null, {
							data: _.assign({}, EDITABLE_INITIATIVE, {status: status})
						}))

					var res = yield this.request(`/initiatives/${UUID}/events/new`)
					res.statusCode.must.equal(200)
				})
			})

			;["inProgress", "closed"].forEach(function(status) {
				it("must respond with 403 if " + status, function*() {
					this.router.get(`/api/users/self/topics/${UUID}`,
						respond.bind(null, {
							data: _.assign({}, EDITABLE_INITIATIVE, {status: status})
						}))

					var res = yield this.request(`/initiatives/${UUID}/events/new`)
					res.statusCode.must.equal(403)
				})
			})

			it("must respond with 403 if not an admin", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: INITIATIVE}))

				var res = yield this.request(`/initiatives/${UUID}/events/new`)
				res.statusCode.must.equal(403)
			})
		})
	})

	describe("POST /", function() {
		describe("when logged in", function() {
			require("root/test/fixtures").user()

			;["voting", "followUp"].forEach(function(status) {
				it("must create event if in " + status, function*() {
					this.router.get(`/api/users/self/topics/${UUID}`,
						respond.bind(null, {
							data: _.assign({}, EDITABLE_INITIATIVE, {status: status})
						}))

					var res = yield this.request(`/initiatives/${UUID}/events`, {
						method: "POST",
						form: {
							_csrf_token: this.csrfToken,
							title: "Something happened",
							text: "You shouldn't miss it."
						}
					})

					res.statusCode.must.equal(302)
					res.headers.location.must.equal(`/initiatives/${UUID}`)

					var events = yield eventsDb.search(sql`
						SELECT * FROM initiative_events
					`)

					events.must.eql([{
						id: events[0].id,
						initiative_uuid: UUID,
						created_at: new Date,
						updated_at: new Date,
						occurred_at: new Date,
						created_by: this.user.id,
						origin: "author",
						title: "Something happened",
						text: "You shouldn't miss it."
					}])
				})
			})

			;["inProgress", "closed"].forEach(function(status) {
				it("must respond with 403 if " + status, function*() {
					this.router.get(`/api/users/self/topics/${UUID}`,
						respond.bind(null, {
							data: _.assign({}, EDITABLE_INITIATIVE, {status: status})
						}))

					var res = yield this.request(`/initiatives/${UUID}/events`, {
						method: "POST",
						form: {_csrf_token: this.csrfToken}
					})

					res.statusCode.must.equal(403)
				})
			})

			it("must email subscribers interested in author events", function*() {
				var subscriptions = yield subscriptionsDb.create([
					new ValidSubscription({
						initiative_uuid: INITIATIVE.id,
						confirmed_at: new Date,
						author_interest: false
					}),

					new ValidSubscription({
						initiative_uuid: null,
						confirmed_at: new Date,
						author_interest: false
					}),

					new ValidSubscription({
						initiative_uuid: INITIATIVE.id,
						confirmed_at: new Date
					}),

					new ValidSubscription({
						initiative_uuid: null,
						confirmed_at: new Date
					})
				])

				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: EDITABLE_INITIATIVE}))

				var res = yield this.request(`/initiatives/${UUID}/events`, {
					method: "POST",
					form: {
						_csrf_token: this.csrfToken,
						title: "Something happened",
						text: "You shouldn't miss it."
					}
				})

				res.statusCode.must.equal(302)

				var messages = yield messagesDb.search(sql`
					SELECT * FROM initiative_messages
				`)

				var emails = subscriptions.slice(2).map((s) => s.email).sort()

				messages.must.eql([{
					id: messages[0].id,
					initiative_uuid: INITIATIVE.id,
					created_at: new Date,
					updated_at: new Date,
					origin: "event",

					title: t("EMAIL_INITIATIVE_AUTHOR_EVENT_TITLE", {
						title: "Something happened",
						initiativeTitle: INITIATIVE.title
					}),

					text: renderEmail("EMAIL_INITIATIVE_AUTHOR_EVENT_BODY", {
						initiativeTitle: INITIATIVE.title,
						initiativeUrl: `${Config.url}/initiatives/${UUID}`,
						title: "Something happened",
						text: "You shouldn't miss it.",
						unsubscribeUrl: "{{unsubscribeUrl}}"
					}),

					sent_at: new Date,
					sent_to: emails
				}])

				this.emails.length.must.equal(1)
				this.emails[0].envelope.to.must.eql(emails)
				var msg = String(this.emails[0].message)
				msg.match(/^Subject: .*/m)[0].must.include(INITIATIVE.title)
				subscriptions.slice(2).forEach((s) => msg.must.include(s.update_token))
			})

			it("must respond with 403 if not an admin", function*() {
				this.router.get(`/api/users/self/topics/${UUID}`,
					respond.bind(null, {data: INITIATIVE}))

				var res = yield this.request(`/initiatives/${UUID}/events`, {
					method: "POST",
					form: {_csrf_token: this.csrfToken}
				})

				res.statusCode.must.equal(403)
			})
		})
	})
})