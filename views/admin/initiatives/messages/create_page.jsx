/** @jsx Jsx */
var Jsx = require("j6pack")
var Page = require("../../page")
var Form = Page.Form
var Flash = Page.Flash
var Config = require("root/config")
var SubscriptionsView =
	require("../../subscriptions/index_page").SubscriptionsView
var linkify = require("root/lib/linkify")
exports = module.exports = CreatePage
exports.MessageView = MessageView

function CreatePage(attrs) {
	var req = attrs.req
	var initiative = attrs.initiative
	var message = attrs.message
	var subscriptions = attrs.subscriptions
	var path = `${req.baseUrl}/initiatives/${initiative.uuid}/messages`
	var preview = attrs.preview

	return <Page
		page="create-message"
		title={"New Message for " + initiative.title}
		req={req}
	>
		<a href={req.baseUrl + "/initiatives"} class="admin-back-2">Initiatives</a>
		<a href={req.baseUrl + "/initiatives/" + initiative.uuid} class="admin-back">
			{initiative.title}
		</a>

		<h1 class="admin-heading">Send New Message to Subscribers</h1>
		<Flash flash={req.flash} />
		{preview ? <MessageView message={preview} /> : null }

		<Form
				req={req}
				action={path}
				method="post"
				class="admin-form"
			>
			<label class="admin-label">Title</label>
			<input
				name="title"
				value={message.title}
				required
				autofocus
				class="admin-input"
			/>

			<label class="admin-label">Text</label>
			<textarea
				name="text"
				required
				maxlength={10000}
				class="admin-input">
				{message.text}
			</textarea>

			<button class="admin-submit" name="action" value="preview">
				Preview Message
			</button>

			{preview ? <button class="admin-danger-button" name="action" value="send">
				Send Message
			</button> : null}
		</Form>

		<h2 class="admin-subheading">
			Subscribed Recipients
			{" "}
			<span class="admin-count">({subscriptions.length})</span>
		</h2>
		<SubscriptionsView subscriptions={subscriptions} all />
	</Page>
}

function MessageView(attrs) {
	var msg = attrs.message

	return <article class="admin-message-preview">
		<table>
			<tr>
				<th>From</th>
				<td>{Config.email.from}</td>
			</tr>
			<tr>
				<th>Subject</th>
				<td>{msg.title}</td>
			</tr>
		</table>

		<p>{Jsx.html(linkify(msg.text))}</p>
	</article>
}
