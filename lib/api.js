var EventEmitter = require('events').EventEmitter
var util = require("util");

var _ = require("underscore");
var cheerio = require("cheerio");
var moment = require("moment");
var log = require("loglevel");

var stringutil = require("./stringutil");

var SMARTHOME_ENDPOINT = 'https://mobile.rwe-smarthome.de'
var POLLING_URL = SMARTHOME_ENDPOINT + '/MobileWeb/LongPolling/GetChanges'
var GETVALUE_URL = SMARTHOME_ENDPOINT + '/MobileWeb/JsonApi/GetLogicalDeviceState'
var SETVALUE_URL = SMARTHOME_ENDPOINT + '/MobileWeb/JsonApi/SetActuatorValue/'

var DEFAULT_HEADERS = {
  "X-Requested-With" : "XMLHttpRequest",
  "Accept"           : "application/json, text/javascript, */*",
  "Content-Type"     : "application/x-www-form-urlencoded",
  "Referrer"         : "https://mobile.rwe-smarthome.de/MobileWeb/OverviewAndControl"
};


/************* TODOS ********************************************
 * This needs a keep alive and/or reconnect mechanism
 * Implement sensor/actuator specific methods and events
 * Implement the Smarthome Alerts/Messages API 
 * Maybe add a simple chaining api like when("bath/window").open().then("bath/heating").off(); 
 * Unit tests
 ****************************************************************/

function SmarthomeError(message, causingError, data) {
  Error.call(this);
  Error.captureStackTrace(this, arguments.callee);
  this.message = message;
  this.name = 'SmarthomeError';
  this.causingError = causingError;
  this.data = data;
}
util.inherits(SmarthomeError, Error);

function SmarthomeObject() {
  EventEmitter.call(this);
}
util.inherits(SmarthomeObject, EventEmitter);
SmarthomeObject.prototype.toString = function() {
  return this.constructor.name+"["+this.name+"]";
}

var findSensor = function( id ) {
  var sensor = _.findWhere(this.sensors, {"id" : id} );
  if (sensor) return sensor;
  sensor = _.findWhere(this.sensors, {"name" : id} );
  if (sensor) return sensor;
  sensor = _.find(this.sensors, function(l) { return l.name.toLowerCase().indexOf(id.toLowerCase()) != -1  } );
  return sensor;
};

var findActuator = function( id ) {
  var act = _.findWhere(this.actuators, {"id" : id} );
  if (act) return act;
  act = _.findWhere(this.actuators, {"name" : id} );
  if (act) return act;
  act = _.find(this.act, function(l) {  return l.name.toLowerCase().indexOf(id.toLowerCase()) != -1  } );
  return act;
}

var findDevice = function( id ) {
  var sensor = _.findWhere(this.sensors, {"id" : id} );
  if (sensor) return sensor;
  var act = _.findWhere(this.actuators, {"id" : id} );
  if (act) return act;
  sensor = _.findWhere(this.sensors, {"name" : id} );
  if (sensor) return sensor;
  act = _.findWhere(this.actuators, {"name" : id} );
  if (act) return act;
  sensor = _.find(this.sensors, function(l) {  return l.name.toLowerCase().indexOf(id.toLowerCase()) != -1 } );
  if (sensor) return sensor;
  act = _.find(this.actuators, function(l) { return l.name.toLowerCase().indexOf(id.toLowerCase()) != -1 } );
  if (act) return act;
  return null;  
}

function SmarthomeLocation( id, name, home ) {
  SmarthomeObject.call(this);
  this.id = id;
  this.name = name;
  this.displayName = stringutil.capitalize(name);
  this.home = home;
  this.sensors = [];
  this.actuators = [];
}
util.inherits(SmarthomeLocation, SmarthomeObject);
SmarthomeLocation.prototype.sensor = findSensor;
SmarthomeLocation.prototype.actuator = findActuator;
SmarthomeLocation.prototype.device = findDevice;
SmarthomeLocation.prototype.temperature = function() {
  var sensor = _.find(this.sensors, function(s) { return (s instanceof SmarthomeTemperatureSensor);});
  if (sensor) return sensor.value;
  return null;
};


function SmarthomeDevice(id, name, data, home) {
  SmarthomeObject.call(this);
  this.id = id;
  this.name = name;
  this.data = data;
  this.home = home;
}
util.inherits(SmarthomeDevice, SmarthomeObject);

SmarthomeDevice.prototype.parseValue = function(value) {
  var self = this;
  var api = self.home;

  var oldValue = self.value;
  var newValue = null;

  if ( typeof(value) == 'undefined' || value == "undefined" || value == "null") {
    newValue = null;
  } else {
    newValue = ""+value;
    newValue = newValue.replace(",",".");
    newValue = newValue.replace("%","");
    newValue = newValue.replace("°","");
    newValue = newValue.replace(".0", "");
    if (newValue.match(/\d+(\.\d*)?/)) {
      newValue = parseFloat(newValue);
    }
  }
  self.value = newValue;
  log.debug("changed " + self + " from " + oldValue + " to " + newValue );
  if (oldValue !== self.value) {
    api.emit('change', self, oldValue);
    self.emit('change', self, oldValue);
  }
}
SmarthomeDevice.prototype.isUnknown = function() { return typeof(this.value) === "undefined" || this.value === "undefined"; };
SmarthomeDevice.prototype.displayValue = function() {
  if (this.value == null) { return "undefined"; };
  return this.value;
}

function SmarthomeSensor(id, name, data, home) {
  SmarthomeDevice.call(this, id, name, data, home);
  this.type = "unknown";
  this.unit = "unknown";
}
util.inherits(SmarthomeSensor, SmarthomeDevice);

function SmarthomeWindowSensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "window";
  this.type = "string";
};
util.inherits(SmarthomeWindowSensor, SmarthomeSensor);
SmarthomeWindowSensor.prototype.isOpen = function() { return "geöffnet" === this.value;};
SmarthomeWindowSensor.prototype.isClosed = function() { return "geschlossen" === this.value;};

function SmarthomeTemperatureSensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "temperature";
  this.unit = "°C";
}
util.inherits(SmarthomeTemperatureSensor, SmarthomeSensor);

function SmarthomeHumiditySensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "humidity";
  this.unit = "%";
}
util.inherits(SmarthomeHumiditySensor, SmarthomeSensor);

function SmarthomeBrightnessSensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "brightness";
  this.unit = "%";
}
util.inherits(SmarthomeBrightnessSensor, SmarthomeSensor);

SmarthomeSensor.create = function(id, name, data, home) {
  var sensor = null;
  if (data.DeviceType == "Rst") {
    var unitSign = data.Value.slice(-1);
    if (unitSign == "°") {
      sensor = new SmarthomeTemperatureSensor(id, name, data, home);
    } else if  (unitSign == "%") {
      sensor = new SmarthomeHumiditySensor(id, name, data, home);
    } else {
      sensor = new SmarthomeSensor(id, name, data, home);
    }
  } else if (data.DeviceType == "Wmd") {
    sensor = new SmarthomeWindowSensor(id, name, data, home);
  } else if (data.DeviceType == "Wds") {
    sensor = new SmarthomeBrightnessSensor(id, name, data, home);
  } else {
    sensor = new SmarthomeSensor(id, name, data, home);
  }
  log.debug("Created " + sensor + " " + sensor.name + " of type " + sensor.type );
  return sensor;
}

function SmarthomeActuator( id, name, data, home ) {
  SmarthomeDevice.call(this, id, name, data, home);
}
util.inherits(SmarthomeActuator, SmarthomeDevice);

SmarthomeActuator.create = function(id, name, data, home) {
  var act = null;
  act = new SmarthomeActuator(id, name, data, home);
  log.debug("Created " + act + " " + act.name + " of type " + act.type );
  return act;
}

SmarthomeActuator.prototype.setValue = function(value, callback) {
  var self = this;
  var api = self.home;
  api.request( { url: SETVALUE_URL,
            followRedirect: false,
        followAllRedirects: false,
                   headers: DEFAULT_HEADERS,
                        qs: { 
                            "_": api.timestamp(),
                            "IsContainer": false,
                            "Value": value,
                            "Id": self.id
                        } }, function (error, response, body) {
                          if (error) {
                            var e = new SmarthomeError("Could not set value for " +self, error);
                            callback(e);
                            api.emit("error", e);
                          }
                          api.requestUpdate( self.id, callback );
                        });
}

function SmarthomeConnection(request, body) {
  SmarthomeObject.call(this);

  this.connected = true;
  this.request = request;

  var sidMatches = /sessionId\s*=\s*\"([a-zA-Z0-9]+)\"/.exec(body);
  this.sessionId = sidMatches[1];
  var lpMatches = /longPollingTimeoutSeconds\s*=\s*(\d+)/.exec(body);
  var longPollingValue = lpMatches[1];
  this.longPollingTimeout = parseInt(longPollingValue) * 1000;

  var $ = cheerio.load(body);

  this.initializeLocations($);
  this.initializeDevices($);

  log.debug("Login to smarthome successfull");

  this.startLongPolling();
}
util.inherits(SmarthomeConnection, SmarthomeObject);
 
SmarthomeConnection.prototype.timestamp = function(response) {
  if (this.lastTimestamp == null) {
    this.lastTimestamp = moment().valueOf();
  } else {
    var newTimestamp = moment().valueOf();
    if (newTimestamp < this.lastTimestamp) {
      newTimestamp = this.lastTimestamp + 1;
      this.lastTimestamp = newTimestamp;
    }
  }
  return ""+this.lastTimestamp;
}

SmarthomeConnection.prototype.startLongPolling = function() {
  var self = this;
  if (!self.connected) return;

  log.debug("Starting long polling");

  self.request( { url: POLLING_URL,
      qs: {"_": self.timestamp(), "sessionId": self.sessionId},
      timeout: self.longPollingTimeout + 5000 },
      function (error, response, body) {
        if (!self.connected) return;
        if (error) {
          if (error.code == 'ETIMEDOUT') {
            log.info("Long polling timeout");
            self.startLongPolling();
          } else {
            var e = new SmarthomeError("error during long polling request", error);
            self.emit("error", e);
            setTimeout( function() { self.startLongPolling(); }, self.longPollingTimeout );
          }
        } else if (response.statusCode == 200) {
          try {
            log.debug("Long polling response received");
            self.updateValues(body);
            self.startLongPolling();
          } catch (err) {
            var e = new SmarthomeError("unexpected response from long polling request", err, {type: "parseError" ,response: body});
            self.emit("error", e);
            self.disconnect();
          }
        } else {
          var e = new SmarthomeError("unexpected response from long polling request", err, {type: "httpStatusError" ,response: body, responseCode: response.statusCode});
          self.emit("error", e);
          self.disconnect();
        }
      });
}

SmarthomeConnection.prototype.updateValues = function(response) {
  var self = this;
  data = JSON.parse(response);

  if (data.error) {
    self.emit("error", new SmarthomeError("Smarthome API indicated error during value update", null, {response: data}));
  } else {
    if (data.changes.length == 0) {
      log.debug("No changes received");
    }
    _.each(data.changes, function( change ) {
      if (change.IsResolveRequired) {
        self.requestUpdate( change.Id )
      } else {
        self.updateValue( change );
      }
    });
  }
}

SmarthomeConnection.prototype.requestUpdate = function( device, callback ) {
  var self = this;

  var id = device;
  if (device instanceof SmarthomeObject) {
    id = device.id;
  }

  self.request( { url: GETVALUE_URL,
       followRedirect: false,
   followAllRedirects: false,
               headers: DEFAULT_HEADERS,
                   qs: { "_": self.timestamp(),
                         "Id": id,
                         "IsResolveRequired": "true",
                         "Value": "null",
                         "Metadata":"" }
                  },
                  function (error, response, body) {
                    if (!self.connected) return;
                    if (error) {
                      self.emit("error", error);
                      if (callback) { callback(error); };
                    } else {
                      var data = {};
                      try {
                        data = JSON.parse(body) 
                      } catch (err) {
                        var e = new SmarthomeError("unexpected response from value update request", err, {type: "parseError" ,response: body});
                        self.emit("error", e);
                        if (callback) { callback(e); };
                        return;
                      }
                      self.updateValue( data, callback );
                    }
                  });
}

SmarthomeConnection.prototype.updateValue = function(change, callback) {
  var self = this;

  if (!change.Id) {
    throw "No ID given";
  }

  var device = self.device( change.Id );
  if (!device) {
    var e = new SmarthomeError("Received updated values for unknown device", null, {type: "invalidData", response: change});
    callback(e);
    return;
  }
  var oldValue = device.value;
  device.valueType = change.Metadata;
  device.parseValue(change.Value);

  if (callback) {
    callback(null, device.value);
  }

}

SmarthomeConnection.prototype.disconnect = function() {
  this.connected = false;
  this.emit("disconnect");
}

SmarthomeConnection.prototype.location = function( id ) {
  var loc = _.findWhere(this.locations, {"id" : id} );
  if (loc) return loc;
  loc = _.findWhere(this.locations, {"name" : id} );
  if (loc) return loc;
  loc = _.find(this.locations, function(l) { return l.name.toLowerCase().indexOf(id.toLowerCase()) != -1 } );
  return loc;
}

SmarthomeConnection.prototype.sensor = findSensor; 
SmarthomeConnection.prototype.actuator = findActuator;
SmarthomeConnection.prototype.device = findDevice;

SmarthomeConnection.prototype.initializeLocations = function($) {
  var self = this;
  self.locations = [];
  var select = $(".roomselect").first();
  select.find("option").each( function(i, elem) {
    var option = $(this)
    var location_id = option.val().substring(2);
    var location_name = option.text();
    self.locations.push( new SmarthomeLocation(location_id, location_name, self) );
  } );
}



SmarthomeConnection.prototype.initializeDevices = function($) {
  var self = this;
  //Initialization keeps track of which elements have been requested
  //and emits an event when values for all are received
  self.requestedDevices = 0;
  self.resolvedDevices = 0;
  var initializationCallback = function(error) {
    //error don't need to be handled here
    if (!error) {
      //check if all requested devices have been initialized yet
      //and if so, emit initialized event
      if (self.requestedDevices > 0) {
        self.resolvedDevices ++;
        if (self.resolvedDevices === self.requestedDevices) {
          self.requestedDevices = 0;
          self.resolvedDevices = 0;
          self.emit('initialized');
          log.debug("All devices initialized");
        }
      }
    }
  }

  self.sensors = []
  self.actuators = []
  self.devices = []
  self.baseDevices = {}

  var script = $("script").last().text();
  var pattern = /SensorManager.load\((.*)\);/;
  var matches = pattern.exec(script);
  var sensorJSON = matches[1]; 
  pattern = /ActuatorManager.load\(\s*(\[.*\])\s*,\s*(\[.*\])/
  matches = pattern.exec(script);
  var locationJSON = matches[1]; 
  var actuatorJSON = matches[2]; 

  var sensorData = JSON.parse(sensorJSON);
  var actuatorData = JSON.parse(actuatorJSON);

  _.each(sensorData, function(element, index) {
      var sensor = SmarthomeSensor.create( element.Id, element.Name, element, self );

      sensor.parseValue( element.Value );

      var container = $("#"+element.Id);
      if (container) {
        var roomdiv = container.parents(".room");
        var locationId = roomdiv.attr("id").substring(2);
        if (locationId) {
          var location = self.location(locationId);
          sensor.location = location;
          location.sensors.push(sensor);
        }
      }
      self.sensors.push( sensor );

      _.each(element.BaseDeviceIds, function(device) {
        if (!self.baseDevices[device]) {
          self.baseDevices[device] = [];
        }
        self.baseDevices[device].push(sensor);
      } );

      if (sensor.value == null) {
        self.requestedDevices++;
        self.requestUpdate(sensor, initializationCallback);
      };
  });

  _.each(actuatorData, function(element, index) {
      var location = self.location(element.LocationId);

      _.each(element.Actuators, function(data) {
        var actuator = SmarthomeActuator.create( data.Id, data.Name, data, self );
        actuator.location = location;
        location.actuators.push(actuator);
        self.actuators.push(actuator);

        _.each(element.BaseDeviceIds, function(device) {
          if (!self.baseDevices[device]) {
            self.baseDevices[device] = [];
          }
          self.baseDevices[device].push(actuator);
        } );

        if (actuator.value == null) { 
          self.requestedDevices++;
          self.requestUpdate(actuator, initializationCallback);
        };
      });
  });

  self.devices = self.devices.concat(self.sensors);
  self.devices = self.devices.concat(self.actuators);
}

module.exports = {
  SmarthomeConnection: SmarthomeConnection,
  SmarthomeError: SmarthomeError,
  Logger: log
};
