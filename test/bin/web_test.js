var O = require("oolong")

describe("Web", function() {
	require("root/test/web")()

	O.each({
		"/votings": "/",
		"/topics": "/",
		"/topics/": "/",
		"/topics/42": "/initiatives/42",
		"/topics/42/discussion": "/initiatives/42/discussion",
		"/topics/42/vote": "/initiatives/42",
		"/topics/42/events": "/initiatives/42/events",
		"/topics/42/events/create?token=42": "/initiatives/42/events/new?token=42",
		"/topics/42/votes/69": "/initiatives/42",
		"/initiatives/42/discussion": "/initiatives/42",
		"/initiatives/42/vote": "/initiatives/42",
		"/initiatives/42/events": "/initiatives/42",
		"/topics/create1": "/initiatives/new",
		"/discussions": "/",
		"/goodpractice": "/about",
		"/support_us": "/donate",
		"/session/new": "/sessions/new",

		"/initiatives/42/events/create?token=42":
			"/initiatives/42/events/new?token=42",
	}, function(to, from) {
		describe(from, function() {
			before(function*() {
				this.res = yield this.request(from, {method: "HEAD"})
			})

			it("must redirect to " + to, function() {
				;[301, 302].must.include(this.res.statusCode)
				this.res.headers.location.must.equal(to)
			})
		})
	})
})
