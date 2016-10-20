window._ = require("./lib/lodash.js")
window.moment = require("./lib/moment-with-locales.js")

void require("./lib/ext/device.min.js")
window.$ = window.jQuery = require("./vendor/jquery.min.js")
void require("./vendor/jquery-ui.min.js")
void require("./lib/ext/jquery.autosize.min.js")
void require("./lib/ext/jquery.functions.js")
void require("./lib/ext/tooltipster/jquery.tooltipster.js")

void require("./lib/angular/angular.js")
void require("./lib/angular/angular-sanitize.js")
void require("./lib/angular/angular-ui-router.js")
void require("./lib/angular/angular-translate.js")
void require("./lib/angular/angular-translate-handler-log.js")
void require("./lib/angular/angular-translate-loader-static-files.js")
void require("./lib/angular/angular-translate-storage-kookies.js")

void require("./lib/angular/angular-contenteditable.js")
void require("./lib/angular/angular-cookie.js")
void require("./lib/angular/angular-elastic.js")
void require("./lib/angular/angular-hotkeys.js")
void require("./lib/angular/angular-hwcrypto.js")
void require("./lib/angular/angular-moment.js")
void require("./lib/angular/angular-placeholder.js")
void require("./lib/angular/angular-qrcode.js")
void require("./lib/angular/angular-socialshare.min.js")
void require("./lib/angular/angular-storage.js")
void require("./lib/angular/angulartics-google-analytics.min.js")
void require("./lib/angular/angulartics.min.js")

void require("./lib/angular/citizenos.js")
void require("./lib/angular/datePicker.js")
void require("./lib/angular/ng-infinite-scroll.js")
void require("./lib/angular/ngDialog.js")
void require("./lib/angular/ngKookies.js")
void require("./lib/angular/toruEtherpad.js")
void require("./lib/angular/toruSelect.js")
void require("./lib/angular/toruSessionSettings.js")
void require("./lib/angular/toruUserVoice.js")
void require("./lib/angular/toruUtils.js")
void require("./lib/angular/typeahead.js")
window.hwcrypto = require("./lib/hwcrypto.js")
void require("./lib/hwcrypto-legacy.js")
void require("./lib/validator.js")

window.app = require("./app.js")

void require("./services/sAuth.js")
void require("./services/sGroup.js")
void require("./services/sProgress.js")
void require("./services/sSearch.js")
void require("./services/sTopic.js")
void require("./services/sTranslate.js")
void require("./services/sUser.js")

void require("./controllers/AppCtrl.js")
void require("./controllers/DashboardCtrl.js")
void require("./controllers/EventsCtrl.js")
void require("./controllers/GroupCtrl.js")
void require("./controllers/HomeCtrl.js")
void require("./controllers/JoinCtrl.js")
void require("./controllers/TopicCtrl.js")
void require("./controllers/forms/AddEmailCtrl.js")
void require("./controllers/forms/GroupCreateFormCtrl.js")
void require("./controllers/forms/GroupEditFormCtrl.js")
void require("./controllers/forms/GroupInviteFormCtrl.js")
void require("./controllers/forms/LoginFormCtrl.js")
void require("./controllers/forms/PasswordForgotFormCtrl.js")
void require("./controllers/forms/PasswordResetFormCtrl.js")
void require("./controllers/forms/ProfileEditCtrl.js")
void require("./controllers/forms/SignUpFormCtrl.js")
void require("./controllers/forms/TopicCommentCreateFormCtrl.js")
void require("./controllers/forms/TopicMembersInviteFormCtrl.js")
void require("./controllers/forms/TopicRenewDeadlineFormCtrl.js")
void require("./controllers/forms/TopicSettingsFormCtrl.js")
void require("./controllers/forms/TopicVoteCreateFormCtrl.js")
void require("./controllers/forms/TopicVoteViewFormCtrl.js")
void require("./controllers/modals/GroupPermissionsViewCtrl.js")
void require("./controllers/modals/GroupTopicsAddCtrl.js")
void require("./controllers/modals/GroupTopicsViewCtrl.js")
void require("./controllers/modals/LoginEstidCtrl.js")
void require("./controllers/modals/TopicPermissionsCtrl.js")
void require("./controllers/modals/TopicVoteSignCtrl.js")

void require("./custom.js")