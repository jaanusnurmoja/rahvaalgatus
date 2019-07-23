var _ = require("root/lib/underscore")
var Neodoc = require("neodoc")
var Time = require("root/lib/time")
var parliamentApi = require("root/lib/parliament_api")
var diff = require("root/lib/diff")
var sql = require("sqlate")
var initiativesDb = require("root/db/initiatives_db")
var eventsDb = require("root/db/initiative_events_db")
var filesDb = require("root/db/initiative_files_db")
var concat = Array.prototype.concat.bind(Array.prototype)
var flatten = Function.apply.bind(Array.prototype.concat, Array.prototype)
var logger = require("root").logger
var EMPTY_ARR = Array.prototype
var PARLIAMENT_URL = "https://www.riigikogu.ee"
var DOCUMENT_URL = PARLIAMENT_URL + "/tegevus/dokumendiregister/dokument"
var FILE_URL = PARLIAMENT_URL + "/download"
var LOCAL_DATE = /\b(\d?\d)\.(\d?\d)\.(\d\d\d\d)\b/
var formatIsoDate = require("root/lib/i18n").formatDate.bind(null, "iso")
var unknown

var USAGE_TEXT = `
Usage: cli parliament-sync (-h | --help)
       cli parliament-sync [options]

Options:
    -h, --help           Display this help and exit.
    --cached             Do not refresh initiatives from the parliament API.
    --uuid=UUID          Refresh a single initiative. Use only with --cached.
`

module.exports = function*(argv) {
  var args = Neodoc.run(USAGE_TEXT, {argv: argv || ["parliament-sync"]})
  if (args["--help"]) return void process.stdout.write(USAGE_TEXT.trimLeft())

	if (args["--uuid"] && !args["--cached"]) {
		console.error("--uuid works only with --cached.")
		process.exit(1)
	}

	if (args["--cached"]) {
		var uuid = args["--uuid"]

		var initiatives = yield initiativesDb.search(sql`
			SELECT * FROM initiatives
			WHERE parliament_api_data IS NOT NULL
			${uuid ? sql`AND uuid = ${uuid}` : sql``}
		`)

		yield initiatives.map((i) => updateInitiative(i, i.parliament_api_data))
	}
	else yield sync()
}

function* sync() {
	var api = _.memoize(parliamentApi)
	var docs = yield api("documents/collective-addresses").then(getBody)
	var pairs = _.zip(yield docs.map(readInitiative), docs)

	pairs = yield pairs.map(function*(initiativeAndDocument) {
		var initiative = initiativeAndDocument[0]
		var document = initiativeAndDocument[1]

		// Because the collective-addresses endpoint doesn't return files,
		// populate them on the first run, but use a cached response afterwards on
		// the assumption that no new files will appear after creation.
		//
		// https://github.com/riigikogu-kantselei/api/issues/14
		if (initiative.parliament_api_data == null)
			document.files = yield api("documents/" + document.uuid).then((res) => (
				res.body.files || EMPTY_ARR
			))
		else
			document.files = initiative.parliament_api_data.files

		return initiativeAndDocument
	})

	var updated = pairs.filter(function(initiativeAndDocument) {
		var initiative = initiativeAndDocument[0]
		var document = initiativeAndDocument[1]

		return initiative.parliament_api_data == null || diff(
			normalizeParliamentDocumentForDiff(initiative.parliament_api_data),
			normalizeParliamentDocumentForDiff(document)
		)
	})

	yield updated.map(function*(initiativeAndDocument) {
		var initiative = initiativeAndDocument[0]
		var doc = initiativeAndDocument[1]

		// Note we need to fetch the document as the /collective-addresses
		// response doesn't include documents' volumes.
		//
		// Don't then fetch all volumes for all documents as some of them include
		// documents unrelated to the initiative. For example, an initiative
		// acceptance decision (https://api.riigikogu.ee/api/documents/d655bc48-e5ec-43ad-9640-8cba05f78427)
		// resides in a "All parliament decisions in 2019" volume.
		doc.relatedDocuments = yield (doc.relatedDocuments || []).map((doc) => (
			api("documents/" + doc.uuid).then(getBody)
		))

		doc.relatedVolumes = yield (doc.relatedVolumes || []).map(getUuid).map(
			readParliamentVolumeWithDocuments.bind(null, api)
		)

		var meetingVolumeUuids = yield doc.relatedDocuments.filter((doc) => (
			doc.documentType == "unitAgendaItemDocument"
		)).map((doc) => doc.volume.uuid)

		var meetingVolumes = yield meetingVolumeUuids.map(
			readParliamentVolumeWithDocuments.bind(null, api)
		)

		doc.missingVolumes = meetingVolumes

		initiative = yield updateInitiative(initiative, doc)

		yield initiativesDb.update(initiative, {
			parliament_api_data: doc,
			parliament_synced_at: new Date
		})
	})
}

function* readInitiative(doc) {
	var initiative

	if (
		doc.senderReference &&
		(initiative = yield initiativesDb.read(doc.senderReference))
	) return initiative

	if (initiative = yield initiativesDb.read(sql`
		SELECT * FROM initiatives WHERE parliament_uuid = ${doc.uuid}
	`)) return initiative

	logger.log("Creating initiative %s (%s)…", doc.uuid, doc.title)

	return {
		parliament_uuid: doc.uuid,
		external: true,
		phase: "parliament",
		title: doc.title ? parseTitle(doc.title) : "",
		author_name: doc.sender || "",

		// TODO: Ensure time parsing is always in Europe/Tallinn and don't depend
		// on TZ being set.
		// https://github.com/riigikogu-kantselei/api/issues/11
		created_at: doc.created ? Time.parseDateTime(doc.created) : new Date
	}
}

function* updateInitiative(initiative, document) {
	logger.log("Updating initiative %s (%s)…", initiative.uuid, document.title)

	var volumes = concat(document.relatedVolumes, document.missingVolumes)
	var statuses = sortStatuses(document.statuses || EMPTY_ARR)
	var update = attrsFrom(document)

	// Deriving initiative attributes from all statuses, not only semantically
	// unique ones as events below. This works for all orderings of
	// MENETLUS_LOPETATUD is before TAGASI_LYKATUD.
	statuses.forEach((document) => _.merge(update, attrsFromStatus(document)))

	if (initiative.uuid == null) {
		initiative.uuid = initiative.parliament_uuid
		initiative = yield initiativesDb.create(_.assign(initiative, update))
	}
	else {
		delete update.phase

		if (diff(initiative, update))
			initiative = yield initiativesDb.update(initiative, update)
	}

	yield createFiles(initiative, document)

	var eventAttrs = []

	// Unique drops later duplicates, which is what we prefer here.
	//
	// Initiative "Poliitikud ei või istuda kahel toolil" in the API has both
	// TAGASI_LYKATUD and MENETLUS_LOPETATUD statuses, with the former created 10
	// days prior. Let's assume the earlier entry is canonical and of more
	// interest to people, and the later MENETLUS_LOPETATUD status perhaps
	// formality.
	eventAttrs = concat(eventAttrs, _.uniqBy(statuses, eventIdFromStatus).map(
		eventAttrsFromStatus.bind(null, document)
	))

	eventAttrs = concat(
		eventAttrs,
		volumes.map(eventAttrsFromVolume.bind(null, document)
	).filter(Boolean))

	eventAttrs = _.values(eventAttrs.reduce((obj, attrs) => (
		(obj[attrs.external_id] = _.merge({}, obj[attrs.external_id], attrs)), obj
	), {}))

	var events = yield eventsDb.search(sql`
		SELECT * FROM initiative_events
		WHERE initiative_uuid = ${initiative.uuid}
		AND origin = 'parliament'
	`)

	var eventsByExternalId = _.indexBy(events, "external_id")

	var createEvents = []
	var updateEvents = []
	eventAttrs.forEach(function(attrs) {
		var event = eventsByExternalId[attrs.external_id]
		if (event && !diff(event, attrs)) return

		attrs.updated_at = new Date
		if (event) return void updateEvents.push([event, mergeEvent(event, attrs)])

		attrs.created_at = new Date
		attrs.initiative_uuid = initiative.uuid
		createEvents.push(attrs)
	})

	events = _.lastUniqBy(concat(
		events,
		yield eventsDb.create(createEvents),
		yield updateEvents.map((eventAndAttrs) => eventsDb.update(...eventAndAttrs))
	), (ev) => ev.id)

	eventsByExternalId = _.indexBy(events, "external_id")

	var volumeDocumentUuids = new Set(flatten(volumes.map((volume) => (
		volume.documents.map(getUuid)
	))))

	var documents = document.relatedDocuments.filter((doc) => (
		!volumeDocumentUuids.has(doc.uuid))
	)

	yield createEventFilesFromVolumes(initiative, events, volumes)
	yield createEventFilesFromRelatedDocuments(initiative, events, documents)

	return initiative
}

function* createFiles(initiative, document) {
	var files = document.files || EMPTY_ARR
	files = files.filter(isPublicFile)
	if (files.length == 0) return

	var existingUuids = new Set(yield filesDb.search(sql`
		SELECT external_id
		FROM initiative_files
		WHERE initiative_uuid = ${initiative.uuid}
		AND event_id IS NULL
	`).then((files) => files.map((file) => file.external_id)))

	files = files.filter((file) => !existingUuids.has(file.uuid))
	files = files.map(newFile.bind(null, initiative, null, document))
	yield filesDb.create(yield files)
}

function* createEventFilesFromRelatedDocuments(initiative, events, documents) {
	yield filesDb.create(flatten(yield documents.map(function(document) {
		var event = findEventFromDocument(events, document)

		if (event === unknown) {
			logger.warn(
				"Ignoring initiative %s document «%s»",
				initiative.uuid,
				document.title
			)

			return EMPTY_ARR
		}

		return newEventFiles(initiative, event, document)
	})))
}

function* createEventFilesFromVolumes(initiative, events, volumes) {
	yield filesDb.create(flatten(yield volumes.map(function*(volume) {
		var event = findEventFromVolume(events, volume)

		if (event == null) {
			logger.warn(
				"Ignoring initiative %s volume «%s»",
				initiative.uuid,
				volume.title
			)

			return EMPTY_ARR
		}

		return flatten(yield volume.documents.map(
			newEventFiles.bind(null, initiative, event)
		))
	})))
}

function* newEventFiles(initiative, event, document) {
	var files = document.files || EMPTY_ARR
	files = files.filter(isPublicFile)
	if (files.length == 0) return EMPTY_ARR

	var existingUuids = new Set(yield filesDb.search(sql`
		SELECT external_id FROM initiative_files WHERE event_id = ${event.id}
	`).then((files) => files.map((file) => file.external_id)))

	files = files.filter((file) => !existingUuids.has(file.uuid))
	files = files.map(newFile.bind(null, initiative, event.id, document))
	return yield files
}

function newFile(initiative, eventId, document, file) {
	logger.log(
		"Downloading initiative %s file «%s»…",
		initiative.uuid,
		file.fileName
	)

	var externalUrl = FILE_URL + "/" + file.uuid

	return parliamentApi(externalUrl).then((res) => ({
		initiative_uuid: initiative.uuid,
		event_id: eventId,
		external_id: file.uuid,
		external_url: externalUrl,
		created_at: new Date,
		updated_at: new Date,
		name: file.fileName,
		title: file.fileTitle || document.title,
		url: DOCUMENT_URL + "/" + document.uuid,
		content: Buffer.from(res.body),
		content_type: res.headers["content-type"]
	}))
}

function attrsFrom(doc) {
	return {
		phase: "parliament",
		parliament_uuid: doc.uuid,

		parliament_committee:
			doc.responsibleCommittee && doc.responsibleCommittee.name
	}
}

function attrsFromStatus(status) {
	var code = status.status.code

	switch (code) {
		case "REGISTREERITUD": return {
			received_by_parliament_at: Time.parseDate(status.date)
		}

		case "MENETLUSSE_VOETUD": return {
			accepted_by_parliament_at: Time.parseDate(status.date)
		}

		case "TAGASI_LYKATUD": return {
			parliament_decision: "reject",
			finished_in_parliament_at: Time.parseDate(status.date)
		}

		case "MENETLUS_LOPETATUD": return {
			phase: "done",
			finished_in_parliament_at: Time.parseDate(status.date)
		}

		case "ARUTELU_KOMISJONIS":
			switch (status.committeeDecision && status.committeeDecision.code) {
				case "LAHENDADA_MUUL_VIISIL":
					return {parliament_decision: "solve-differently"}
				case "ETTEPANEK_TAGASI_LYKATA":
					return {parliament_decision: "reject"}
				case "ETTEPANEK_INSTITUTSIOONILE":
					return {parliament_decision: "forward"}

				default: return null
			}

		default: throw new RangeError("Unrecognized status: " + code)
	}
}

function eventAttrsFromStatus(document, status) {
	var attrs = {
		type: eventTypeFromStatus(status),
		origin: "parliament",
		external_id: eventIdFromStatus(status),
		occurred_at: Time.parseDate(status.date)
	}

	switch (status.status.code) {
		case "ARUTELU_KOMISJONIS":
			attrs.content = {
				committee: document.responsibleCommittee
					? document.responsibleCommittee.name
					: null,

				decision: status.committeeDecision
					? parseMeetingDecision(status.committeeDecision)
					: undefined
			}
			break
	}

	return attrs
}

function eventAttrsFromVolume(document, volume) {
	if (isMeetingVolume(volume)) {
		// TODO: Parse the time as well.
		var date = parseInlineDate(volume.title)
		if (date == null) return null

		var topic = document.relatedDocuments.find((doc) => (
			isMeetingTopicDocument(doc) &&
			doc.volume.uuid == volume.uuid
		))

		return {
			type: "parliament-committee-meeting",
			origin: "parliament",
			external_id: eventIdFromVolume(volume),
			occurred_at: date,

			content: {
				committee: document.responsibleCommittee
					? document.responsibleCommittee.name
				: null,

				invitees: topic ? topic.invitees : undefined
			}
		}
	}
	else return null
}

function findEventFromDocument(events, document) {
	if (
		document.documentType == "decisionDocument" &&
		document.title == "Kollektiivse pöördumise menetlusse võtmine"
	) return events.find((ev) => ev.type == "parliament-accepted")

	if (document.documentType == "protokoll") {
		var date = (
			parseInlineDate(document.title) ||
			document.volume && parseInlineDate(document.volume.title)
		)

		if (date == null) return unknown
		return events.find((ev) => Time.isSameDate(ev.occurred_at, date))
	}

	if (
		document.documentType == "letterDocument" &&
		document.title.match(/\bvastuskiri\b/i)
	) return events.find((ev) => ev.type == "parliament-finished")

	if (isMeetingTopicDocument(document)) return null

	return unknown
}

function findEventFromVolume(events, volume) {
	var id = eventIdFromVolume(volume)
	return id && events.find((ev) => ev.external_id == id)
}

function eventIdFromVolume(volume) {
	if (isMeetingVolume(volume)) {
		var date = parseInlineDate(volume.title)
		if (date == null) return null
		return "ARUTELU_KOMISJONIS/" + formatIsoDate(date)
	}

	return null
}

function eventIdFromStatus(obj) {
	var code = obj.status.code

	switch (code) {
		case "REGISTREERITUD":
		case "MENETLUSSE_VOETUD":
		case "MENETLUS_LOPETATUD": return code
		case "TAGASI_LYKATUD": return "MENETLUS_LOPETATUD"
		case "ARUTELU_KOMISJONIS": return code + "/" + obj.date
		default: throw new RangeError("Unrecognized status: " + code)
	}
}

function eventTypeFromStatus(obj) {
	var code = obj.status.code

	switch (code) {
		case "REGISTREERITUD": return "parliament-received"
		case "MENETLUSSE_VOETUD": return "parliament-accepted"
		case "TAGASI_LYKATUD": return "parliament-finished"
		case "MENETLUS_LOPETATUD": return "parliament-finished"
		case "ARUTELU_KOMISJONIS": return "parliament-committee-meeting"
		default: throw new RangeError("Unrecognized status: " + code)
	}
}

function parseMeetingDecision(obj) {
	switch (obj.code) {
		case "JATKATA_ARUTELU": return "continue"
		case "LAHENDADA_MUUL_VIISIL": return "solve-differently"
		case "ETTEPANEK_TAGASI_LYKATA": return "reject"
		case "ETTEPANEK_INSTITUTSIOONILE": return "forward"
		default: throw new RangeError("Unrecognized decision: " + obj.code)
	}
}

function parseInlineDate(str) {
	var parts = LOCAL_DATE.exec(str)
	return parts && new Date(+parts[3], +parts[2] - 1, +parts[1])
}

function parseTitle(title) {
	title = title.replace(/^Kollektiivne pöördumine\s+/i, "")
	title = title.replace(/^"(.*)"$/, "$1")
	return title
}

function normalizeParliamentDocumentForDiff(doc) {
	return {
		__proto__: doc,
		statuses: doc.statuses && sortStatuses(doc.statuses),
		relatedDocuments: doc.relatedDocuments && doc.relatedDocuments.map(getUuid),
		relatedVolumes: doc.relatedVolumes && doc.relatedVolumes.map(getUuid),
		missingVolumes: null
	}
}

function* readParliamentVolumeWithDocuments(api, uuid) {
	var volume = yield api("volumes/" + uuid).then(getBody)

	volume.documents = yield volume.documents.map((doc) => (
		!isMeetingTopicDocument(doc) &&
		api("documents/" + doc.uuid).then(getBody)
	)).filter(Boolean)

	return volume
}

function sortStatuses(statuses) {
	return _.sortBy(statuses, [
		(obj) => obj.date,
		(obj) => obj.status.code
	])
}

function isMeetingVolume(volume) {
	return volume.volumeType == "unitSittingVolume"
}

function isMeetingTopicDocument(doc) {
	return doc.documentType == "unitAgendaItemDocument"
}

function mergeEvent(event, attrs) {
	if (event.type == "parliament-committee-meeting") {
		attrs.content = _.assign({}, event.content, attrs.content, {
			committee: event.content.committee
		})
	}

	return attrs
}

function getBody(res) { return res.body }
function getUuid(res) { return res.uuid }
function isPublicFile(file) { return file.accessRestrictionType == "PUBLIC" }