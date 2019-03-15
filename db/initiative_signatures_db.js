var O = require("oolong")
var Db = require("root/lib/sqlite_heaven")
var sqlite = require("root").sqlite
exports = module.exports = new Db(Object, sqlite, "initiative_signatures")

exports.parse = function(attrs) {
	return O.defaults({
		updated_at: attrs.updated_at && new Date(attrs.updated_at),
		hidden: !!attrs.hidden
	}, attrs)
}