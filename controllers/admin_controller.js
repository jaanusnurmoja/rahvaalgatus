var _ = require("root/lib/underscore")
var Router = require("express").Router
var Config = require("root/config")
var HttpError = require("standard-http-error")
var DateFns = require("date-fns")
var Time = require("root/lib/time")
var {isAdmin} = require("root/lib/user")
var subscriptionsDb = require("root/db/initiative_subscriptions_db")
var commentsDb = require("root/db/comments_db")
var next = require("co-next")
var initiativesDb = require("root/db/initiatives_db")
var cosDb = require("root").cosDb
var sqlite = require("root").sqlite
var sql = require("sqlate")
var concat = Array.prototype.concat.bind(Array.prototype)
var PARTNER_IDS = concat(Config.apiPartnerId, _.keys(Config.partners))
exports = module.exports = Router()

exports.use(function(req, _res, next) {
	if (req.user && isAdmin(req.user)) next()
	else next(new HttpError(401, "Not an Admin"))
})

exports.use(function(req, _res, next) {
	req.rootUrl = req.baseUrl
	next()
})

exports.get("/", next(function*(req, res) {
	var from = req.query.from
		? Time.parseDate(req.query.from)
		: DateFns.startOfMonth(new Date)

	var to = req.query.to ? Time.parseDate(req.query.to) : null

	var authenticationsCount = yield sqlite(sql`
		SELECT
			COUNT(*) AS "all",
			SUM(method == 'id-card') AS id_card,
			SUM(method == 'mobile-id') AS mobile_id,
			SUM(method == 'smart-id') AS smart_id

		FROM sessions
		WHERE created_at >= ${from}
		${to ? sql`AND created_at < ${to}` : sql``}
	`).then(_.first).then((res) => _.mapValues(res, Number))

	var signatureCount = yield sqlite(sql`
		SELECT
			COUNT(*) AS "all",
			SUM(method == 'id-card') AS id_card,
			SUM(method == 'mobile-id') AS mobile_id,
			SUM(method == 'smart-id') AS smart_id

		FROM initiative_signatures
		WHERE created_at >= ${from}
		${to ? sql`AND created_at < ${to}` : sql``}
	`).then(_.first).then((res) => _.mapValues(res, Number))

	var signerCount = yield sqlite(sql`
		WITH signers AS (
			SELECT DISTINCT personal_id
			FROM initiative_signatures
			WHERE created_at >= ${from}
			${to ? sql`AND created_at < ${to}` : sql``}
		)

		SELECT COUNT(*) AS count FROM signers
	`).then(_.first).then((res) => Number(res.count))

	var citizenSignatureCount = yield cosDb.query(sql`
		WITH signatures AS (
			SELECT DISTINCT ON (sig."voteId", sig."userId") opt.value AS support
			FROM "VoteLists" AS sig
			JOIN "VoteOptions" AS opt ON opt.id = sig."optionId"
			WHERE sig."createdAt" >= ${from}
			${to ? sql`AND sig."createdAt" < ${to}` : sql``}
			ORDER BY sig."voteId", sig."userId", sig."createdAt" DESC
		)

		SELECT COUNT(*) as count FROM signatures
		WHERE support = 'Yes'
	`).then(_.first).then((res) => Number(res.count))

	var citizenSignerCount = yield cosDb.query(sql`
		WITH signatures AS (
			SELECT DISTINCT ON (sig."voteId", sig."userId")
				sig."userId",
				opt.value AS support

			FROM "VoteLists" AS sig
			JOIN "VoteOptions" AS opt ON opt.id = sig."optionId"
			WHERE sig."createdAt" >= ${from}
			${to ? sql`AND sig."createdAt" < ${to}` : sql``}
			ORDER BY sig."voteId", sig."userId", sig."createdAt" DESC
		),

		signers AS (
			SELECT DISTINCT ON ("userId") *
			FROM signatures
			WHERE support = 'Yes'
		)

		SELECT COUNT(*) AS count FROM signers
	`).then(_.first).then((res) => Number(res.count))

	var topicCount = yield cosDb.query(sql`
		SELECT COUNT(*)
		FROM "Topics"
		WHERE "createdAt" >= ${from}
		${to ? sql`AND "createdAt" < ${to}` : sql``}
		AND "deletedAt" IS NULL
		AND "visibility" = 'public'
		AND "sourcePartnerId" IN ${sql.in(PARTNER_IDS)}
	`).then(_.first).then((res) => Number(res.count))

	var externalInitiativesCount = yield initiativesDb.select1(sql`
		SELECT COUNT(*) AS count
		FROM initiatives
		WHERE external
		AND "created_at" >= ${from}
		${to ? sql`AND "created_at" < ${to}` : sql``}
	`).then((res) => Number(res.count))

	var milestones = yield initiativesDb.search(sql`
		SELECT signature_milestones
		FROM initiatives
		WHERE signature_milestones != '{}'
	`).then((rows) => rows.map((row) => row.signature_milestones))

	var successfulCount = _.sum(_.map(milestones, (milestones) => (
		milestones[1000] &&
		milestones[1000] >= from &&
		milestones[1000] < to ? 1 : 0
	)))

	var voteCount = yield cosDb.query(sql`
		SELECT COUNT(*)
		FROM "Topics" AS topic
		JOIN "TopicVotes" AS tv ON tv."topicId" = topic.id
		JOIN "Votes" AS vote ON vote.id = tv."voteId"

		WHERE vote."createdAt" >= ${from}
		${to ? sql`AND vote."createdAt" < ${to}` : sql``}
		AND topic."deletedAt" IS NULL
		AND topic."sourcePartnerId" IN ${sql.in(PARTNER_IDS)}
	`).then(_.first).then((res) => Number(res.count))

	var sentToParliamentCount = yield sqlite(sql`
		SELECT COUNT(*) as count
		FROM initiatives
		WHERE phase IN ('parliament', 'government', 'done')
		AND NOT external
		AND sent_to_parliament_at >= ${from}
		${to ? sql`AND sent_to_parliament_at < ${to}` : sql``}
	`).then(_.first).then((res) => Number(res.count))

	var subscriberCount = yield subscriptionsDb.search(sql`
		WITH emails AS (
			SELECT DISTINCT email
			FROM initiative_subscriptions
			WHERE confirmed_at >= ${from}
			${to ? sql`AND confirmed_at < ${to}` : sql``}
		)

		SELECT COUNT(*) as count FROM emails
	`).then(_.first).then((res) => Number(res.count))

	var lastSubscriptions = yield subscriptionsDb.search(sql`
		SELECT *
		FROM initiative_subscriptions
		ORDER BY created_at DESC
		LIMIT 15
	`)

	var subscriptionInitiatives = _.indexBy(yield cosDb.query(sql`
		SELECT id AS uuid, title
		FROM "Topics"

		WHERE id IN ${sql.in(_.uniq(lastSubscriptions.map((s) => (
			s.initiative_uuid)
		)))}
	`), "uuid")

	lastSubscriptions.forEach(function(sub) {
		sub.initiative = subscriptionInitiatives[sub.initiative_uuid]
	})

	res.render("admin/dashboard_page.jsx", {
		from: from,
		to: to,
		lastSubscriptions: lastSubscriptions,
		authenticationsCount: authenticationsCount,
		signatureCount: signatureCount,
		signerCount: signerCount,
		citizenSignatureCount: citizenSignatureCount,
		citizenSignerCount: citizenSignerCount,
		subscriberCount: subscriberCount,
		successfulCount: successfulCount,
		initiativesCount: topicCount,
		externalInitiativesCount: externalInitiativesCount,
		voteCount: voteCount,
		sentToParliamentCount: sentToParliamentCount
	})
}))

exports.use("/users", require("./admin/users_controller").router)
exports.use("/initiatives", require("./admin/initiatives_controller").router)

exports.get("/comments", next(function*(_req, res) {
	var comments = yield commentsDb.search(sql`
		SELECT comment.*, user.id AS user_id, user.name AS user_name
		FROM comments AS comment
		JOIN users AS user ON comment.user_id = user.id
		ORDER BY created_at DESC
		LIMIT 15
	`)

	res.render("admin/comments/index_page.jsx", {comments: comments})
}))

exports.get("/subscriptions", next(function*(_req, res) {
	var subscriptions = yield subscriptionsDb.search(sql`
		SELECT *
		FROM initiative_subscriptions
		WHERE initiative_uuid IS NULL
		ORDER BY created_at DESC
	`)

	res.render("admin/subscriptions/index_page.jsx", {
		subscriptions: subscriptions
	})
}))
