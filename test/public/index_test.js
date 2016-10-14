var _ = require("lodash")
var O = require("oolong")
var Config = require("root/config/test")
var Moment = require("moment")
var InitiativePage = require("./initiative_page")
var InitiativeCreatePage = require("./initiative_create_page")
var TOKEN = Config.sessions[1]

var DEFAULT_INITIATIVE = {
	"description": "<!DOCTYPE HTML><html><body><h1>Automation Proposal</h1><br><p>More automated tests!</p></body></html>",
	"visibility": "public",
	"endsAt": Moment().startOf("day").add(90, "days").toDate(),
	"contact": {"name": "", "email": "", "phone": ""}
}

var DEFAULT_VOTE = {
	"options": [{"value": "Yes"}, {"value": "No"}],
	"delegationIsAllowed": false,
	"endsAt": Moment().startOf("day").add(90, "days").toDate(),
	"type": "regular",
	"authType": "hard"
}

if (process.env.TEST.match(/\bui\b/))
describe("Rahvaalgatus", function() {
	require("root/test/web")()
	require("root/test/api")()
	require("root/test/browser")()
	this.timeout(10000)

	describe("/", function() {
		it("must show beta warning", function*() {
			yield this.browser.get(this.url)
			var dialog = yield this.browser.querySelector("#dear_user_dialog")
			yield dialog.isDisplayed().must.then.be.true()
		})

		it("must not show beta warning twice", function*() {
			yield this.browser.get(this.url)
			var dialog

			dialog = this.browser.querySelector("#dear_user_dialog")
			yield dialog.querySelector("[title=Close]").click()

			yield this.browser.get(this.url)
			dialog = this.browser.querySelector("#dear_user_dialog")
			yield dialog.isPresent().must.then.be.false()
		})
	})

	describe("/topics/new", function() {
		beforeEach(signIn)
		beforeEach(acceptBeta)

		it("must create a new initiative", function*() {
			var deadline = Moment().startOf("day").add(3, "day").toDate()
			var page = yield InitiativeCreatePage.open(this.browser, this.url)

			yield page.title.sendKeys("Automation Proposal")
			yield page.acceptTos()
			page = yield page.next()

			yield page.setDeadline(deadline)
			page = yield page.next()

			// No authors for happy-path.
			page = yield page.next()
			
			var res = yield this.api(`/api/users/self/topics/${yield page.id}`)
			var initiative = res.body.data

			initiative.title.must.equal("Automation Proposal")
			initiative.status.must.equal("inProgress")
			initiative.visibility.must.equal("private")
			initiative.endsAt.must.equal(formatTime(Moment(deadline).endOf("day")))
		})

		it("must create initiative with co-author", function*() {
			var deadline = Moment().startOf("day").add(3, "day").toDate()
			var page = yield InitiativeCreatePage.open(this.browser, this.url)

			yield page.title.sendKeys("Automation Proposal")
			yield page.acceptTos()
			page = yield page.next()

			yield page.setDeadline(deadline)
			page = yield page.next()

			yield page.author.sendKeys("andri@dot.ee")
			yield page.el.querySelector(".ac-dataset").click()
			page = yield page.next()
			
			var id = yield page.id
			var res = yield this.api(`/api/users/self/topics/${id}/members`)
			var members = res.body.data

			var users = _.sortBy(members.users.rows, "name")
			users.length.must.equal(2)
			users[0].name.must.equal("Andri")
		})
	})

	describe("/topics/:id", function() {
		beforeEach(acceptBeta)

		describe("when in discussion", function() {
			beforeEach(signIn)

			it("must send discussion to voting", function*() {
				var query = this.browser.querySelector.bind(this.browser)
				var tomorrow = Moment().startOf("day").add(1, "day").toDate()
				var tomorrowString = formatDate(tomorrow)

				var res = yield this.api("/api/users/self/topics", {
					method: "POST",
					json: DEFAULT_INITIATIVE
				})

				var initiative = res.body.data, id = initiative.id
				yield this.browser.get(this.url + "/topics/" + id)

				yield sleep(500)
				yield query(".collect-signatures a").click()

				yield sleep(500)
				yield query(`.deadline-date a[data-date="${tomorrowString}"]`).click()
				yield query(".admin-role-cal .sign-in a").click()

				yield sleep(500)
				res = yield this.api(`/api/users/self/topics/${id}`)
				initiative = res.body.data

				var voteId = initiative.vote.id
				res = yield this.api(`/api/users/self/topics/${id}/votes/${voteId}`)
				var vote = res.body.data

				vote.endsAt.must.equal(formatTime(Moment(tomorrow).endOf("day")))
			})

			it("must show publish button if private", function*() {
				var initiative = yield createDiscussion(this.api, {
					"visibility": "private"
				})

				var id = initiative.id
				var page = yield InitiativePage.open(this.browser, this.url, id)
				var body = yield page.el.querySelector("aside").textContent
				body.must.include("Muuda avalikuks")
			})

			it("must not show unpublish button if public", function*() {
				var initiative = yield createDiscussion(this.api)
				var id = initiative.id
				var page = yield InitiativePage.open(this.browser, this.url, id)
				var body = yield page.el.querySelector("aside").textContent
				body.must.not.include("Muuda privaatseks")
			})

			it("must show close discussion button", function*() {
				var initiative = yield createDiscussion(this.api)
				var id = initiative.id
				var page = yield InitiativePage.open(this.browser, this.url, id)
				var body = yield page.el.querySelector("aside").textContent
				body.must.include("Peata arutelu")
			})
		})
		
		describe("when in voting", function() {
			beforeEach(signIn)

			it("must not show unpublish button", function*() {
				var initiative = yield createVote(this.api)
				var id = initiative.id
				var page = yield InitiativePage.open(this.browser, this.url, id)
				var body = yield page.el.querySelector("aside").textContent
				body.must.not.include("Muuda privaatseks")
			})

			it("must not show close discussion button", function*() {
				var initiative = yield createVote(this.api)
				var id = initiative.id
				var page = yield InitiativePage.open(this.browser, this.url, id)
				var body = yield page.el.querySelector("aside").textContent
				body.must.not.include("Peata arutelu")
			})
		})

		describe("when in voting but not signed in", function() {
			it("must show initiative to anonymous user", function*() {
				var initiative = yield createVote(this.api)
				var id = initiative.id
				var page = yield InitiativePage.open(this.browser, this.url, id)
				var body = yield page.el.body.textContent
				body.must.include("Anna sellele algatusele oma allkiri!")
			})
		})
	})
})

function* acceptBeta() {
	yield ensureAt(this.browser, this.url)

	var browser = this.browser.manage()
	yield browser.addCookie("dearuser", "dearuser", "/", ".rahvaalgatus.ee")
}

function* signIn() {
	yield ensureAt(this.browser, this.url)

	yield this.browser.eval(function(token) {
		window.localStorage.setItem("citizenos.accessToken", JSON.stringify(token))
	}, TOKEN)
}

function* createDiscussion(api, attrs) {
	var res = yield api("/api/users/self/topics", {
		method: "POST",
		json: O.merge({}, DEFAULT_INITIATIVE, attrs)
	})

	return res.body.data
}

function* createVote(api, attrs) {
	var res = yield api("/api/users/self/topics", {
		method: "POST",
		json: O.merge({}, DEFAULT_INITIATIVE, attrs)
	})

	var initiative = res.body.data

	res = yield api(`/api/users/self/topics/${initiative.id}/votes`, {
		method: "POST",
		json: DEFAULT_VOTE
	})

	return initiative
}

function* ensureAt(browser, url) {
	if (!~(yield browser.getCurrentUrl()).indexOf(url)) yield browser.get(url)
}

function sleep(timeout) { return (fn) => setTimeout(fn, timeout) }
function formatDate(date) { return Moment(date).format("YYYY-MM-DD") }
function formatTime(time) { return time.toISOString() }
