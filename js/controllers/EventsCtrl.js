"use strict";

app.controller("EventsCtrl", ["$scope", "$state", "ngDialog", "sTopic", function($scope, $state, ngDialog, sTopic) {
  $scope.events = {
    status: null,
    list:   []
  };

  $scope.$watch("topic.id", function(topicId) {
    if (topicId && $scope.events.status === null) {
      loadEvents(topicId);
    }
  });

  $scope.openNewEntryDialog = function() {
    $scope.event = {
      subject: "",
      text: ""
    };

    ngDialog.open({
      template: "/templates/modals/topicEventsCreate.html",
      scope: $scope
    });
  };

  $scope.postEvent = function() {
    $scope.savingEvent = true;

    sTopic.eventCreate($scope.topic.id, $scope.event)
      .then(function(event) {
        $scope.events.list.push(event);
        $state.go('^');
      })
      .catch(function(error) {
        console.log("failed", error);
        $scope.savingError = error.message;
      })
      .finally(function() {
        $scope.savingEvent = false;
      });
  };

  if ($state.current.url === "/create") {
    $scope.openNewEntryDialog();
  }

  function loadEvents(topicId) {
    $scope.events.status = 'loading';

    sTopic.eventsList(topicId).then(function(events) {
      $scope.events.status = 'loaded';
      $scope.events.list = events;
    }, function(error) {
      $scope.events.status = 'failed';
    });
  }
}]);