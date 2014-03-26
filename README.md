= RWE Smarthome API =

Scrapes the RWE Smarthome Mobile Web Interface and implements the
long polling mechanism that this site uses to be notified of changes.


*This is not yet in a usable state!*


The biggest problem is that it seems to timeout after a while and receives
invalid response from the server (unfortunately with status 200).



Use it like this:

```js
var smarthome = require('smarthome');

smarthome.connect(USERNAME, PASSWORD, function( error, api ) {
  if (error) {
    console.log("error:" + error);
    process.exit();
  }

  //list sensors
  //(the same works for api.devices and api.locations)
  for (var i = 0; i < api.sensors.length; i++) {
    var s = api.sensors[i];
    console.log("Found sensor " + s.name + " in " + s.location.displayName);
  }

  //you can search for devices or locations by id
  var bath = api.location("dead1-beef2-cafe3-1234-5678");
  var x = api.device("dead1-beef2-cafe3-1234-5678");

  //or by name (case insensitive substring match)
  var livingroom = api.location("livingroom");
  //even on a location
  var windowinlivingroom = livingroom.sensor("window");

  //event "initialized" will be emitted when all devices
  //have fetched their initial value
  api.on("initialized", function() {
    for (var i = 0; i < api.locations.length; i++) {
      var loc = api.locations[i];
      console.log( loc.displayName + ": " + loc.temperature() );
    }

    //watch for changes like this:
    windowinlivingroom.on("change", function(window, oldValue) {
      console.log("Window in living room changed from " + oldValue + " to " + window.value);
    });

    //or for all changes:
    api.on("change", function(device, oldValue) {
      console.log(device.name + " changed from " + oldValue + " to " + device.value);
    });
  }

  //You can set values like this:
  var actuator = api.actuator("dead1-beef2-cafe3-1234-5678");
  actuator.setValue(1, function(error, newvalue) { ... } );
  //the callback is not required - watch the device for changes when you need to be informed 


  //finally, very very rough error handling:
  api.on("error", function(error) {
    console.log(error);
  });

});
```
