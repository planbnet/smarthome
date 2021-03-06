var EventEmitter = require('events').EventEmitter
var util = require("util");

var _ = require("underscore");
var cheerio = require("cheerio");
var moment = require("moment");
var log = require("loglevel");
var async = require("async");

var SMARTHOME_ENDPOINT = 'https://mobile.rwe-smarthome.de';
var CSVEXPORT_URL = SMARTHOME_ENDPOINT + '/MobileWeb/DeviceActivityLogging/Export';
var MESSAGE_URL = SMARTHOME_ENDPOINT + '/MobileWeb/MessagesAndAlerts';
var POLLING_URL = SMARTHOME_ENDPOINT + '/MobileWeb/LongPolling/GetChanges';
var GETVALUE_URL = SMARTHOME_ENDPOINT + '/MobileWeb/JsonApi/GetLogicalDeviceState';
var SETVALUE_URL = SMARTHOME_ENDPOINT + '/MobileWeb/JsonApi/SetActuatorValue/';
var LOGOUT_URL = SMARTHOME_ENDPOINT + '/MobileWeb/Logon/Logoff';

var DEFAULT_HEADERS = {
  "X-Requested-With" : "XMLHttpRequest",
  "Accept"           : "application/json, text/javascript, */*",
  "Content-Type"     : "application/x-www-form-urlencoded",
  "Referrer"         : "https://mobile.rwe-smarthome.de/MobileWeb/OverviewAndControl"
};


/************* TODOS ********************************************
 * Implement a reconnect mechanism when the session is invalidated
 * Implement sensor/actuator specific methods and events
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
  var str = this.constructor.name;
  if (this.displayName && this.location) {
    str = str + "[" + this.displayName + "@" + this.location.displayName + "]"
  } else if (this.displayName) {
    str = str + "[" + this.displayName + "]";
  } else if (this.name) {
    str = str + "[" + this.name + "]";
  } else {
    str = str + "[" + this.id + "]";
  };
  return str;
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
  this.displayName = capitalize(name, true);
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
  this.displayName = capitalize(name, true);
  this.data = data;
  this.home = home;
  this.valueType = "string";
}
util.inherits(SmarthomeDevice, SmarthomeObject);

SmarthomeDevice.prototype.bool = function() {
  return (this.value >= 1);
}

SmarthomeDevice.prototype.parseValue = function(value) {
  var self = this;
  var api = self.home;

  var oldValue = self.value;
  self.value = parseResponseValue(value);
  if (api.initialized) {
    log.info("Changed " + self + " from " + oldValue + " to " + self.value );
  } else {
    log.debug("Initialized " + self + " to " + self.value );
  }
  if (oldValue !== self.value) {
    api.emit('change', self, oldValue);
    self.emit('change', self, oldValue);
  }
}
SmarthomeDevice.prototype.isUnknown = function() { return typeof(this.value) === "undefined" || this.value === "undefined"; };
SmarthomeDevice.prototype.displayValue = function() {
  if (this.value == null) { return "undefined"; };
  var v = this.value;
  if (this.unit) return v+""+this.unit;
  return v;
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
  this.unit = null;
  this.valueType = "string";
};
util.inherits(SmarthomeWindowSensor, SmarthomeSensor);
SmarthomeWindowSensor.prototype.isOpen = function() { return "geöffnet" === this.value;};
SmarthomeWindowSensor.prototype.isClosed = function() { return "geschlossen" === this.value;};
SmarthomeWindowSensor.prototype.displayValue = function() {
  if (this.value === 1) {
    return "open";
  } else if (this.value === 0) {
    return "closed";
  } else {
    return "undefined";
  }
}


function SmarthomeTemperatureSensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "temperature";
  this.unit = "°C";
  this.valueType = "float";
}
util.inherits(SmarthomeTemperatureSensor, SmarthomeSensor);

function SmarthomeHumiditySensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "humidity";
  this.unit = "%";
  this.valueType = "float";
}
util.inherits(SmarthomeHumiditySensor, SmarthomeSensor);

function SmarthomeBrightnessSensor(id, name, data, home) {
  SmarthomeSensor.call(this, id, name, data, home);
  this.type = "brightness";
  this.unit = "%";
  this.valueType = "float";
}
util.inherits(SmarthomeBrightnessSensor, SmarthomeSensor);

SmarthomeSensor.create = function(id, name, data, home) {
  var sensor = null;
  if (data.DeviceType == "Rst") {
    var unitSign = data.Value.slice(-1);
    if (unitSign == "°") {
      sensor = new SmarthomeTemperatureSensor(id, name, data, home);
    } else if (unitSign == "%") {
      sensor = new SmarthomeHumiditySensor(id, name, data, home);
    } else {
      sensor = new SmarthomeSensor(id, name, data, home);
    }
  } else if (data.DeviceType == "Wds") {
    sensor = new SmarthomeWindowSensor(id, name, data, home);
  } else if (data.DeviceType == "Wmd") {
    sensor = new SmarthomeBrightnessSensor(id, name, data, home);
  } else {
    sensor = new SmarthomeSensor(id, name, data, home);
  }
  log.debug("Created " + sensor + " of type " + sensor.type );
  return sensor;
}

function SmarthomeActuator( id, name, data, home ) {
  SmarthomeDevice.call(this, id, name, data, home);
  this.type = "unknown";
}
util.inherits(SmarthomeActuator, SmarthomeDevice);

SmarthomeActuator.prototype.toggle = function(callback) {
  if (this.valueType == "boolean") {
    if (this.value === 1) {
      this.setValue(0, callback);
    } else if (this.value === 0) {
      this.setValue(1, callback);
    }
  }
}


function SmarthomeVariable( id, name, data, home ) {
  SmarthomeActuator.call(this, id, name, data, home);
  this.type = "variable";
  this.valueType = "boolean";
}
util.inherits(SmarthomeVariable, SmarthomeActuator);
SmarthomeVariable.prototype.displayValue = function() {
  if (this.value === 1) {
    return "true";
  } else if (this.value === 0) {
    return "false";
  } else {
    return "undefined";
  }
}

function SmarthomeElectricalDevice( id, name, data, home ) {
  SmarthomeActuator.call(this, id, name, data, home);
  this.type = "elecdev";
  this.valueType = "boolean";
}
util.inherits(SmarthomeElectricalDevice, SmarthomeActuator);
SmarthomeElectricalDevice.prototype.displayValue = function() {
  if (this.value === 1) {
    return "on";
  } else if (this.value === 0) {
    return "off";
  } else {
    return "undefined";
  }
}

function SmarthomeLight( id, name, data, home ) {
  SmarthomeActuator.call(this, id, name, data, home);
  this.type = "light";
  this.valueType = "boolean";
}
util.inherits(SmarthomeLight, SmarthomeActuator);
SmarthomeLight.prototype.displayValue = function() {
  if (this.value === 1) {
    return "on";
  } else if (this.value === 0) {
    return "off";
  } else {
    return "undefined";
  }
}

function SmarthomeHeating( id, name, data, home ) {
  SmarthomeActuator.call(this, id, name, data, home);
  this.type = "heating";
  this.valueType = "float";
  this.minValue = data.MinValue;
  this.maxValue = data.MaxValue;
  this.step = data.Step;
  this.unit = "°C";
}
util.inherits(SmarthomeHeating, SmarthomeActuator);

SmarthomeActuator.create = function(id, name, data, home) {
  var act = null;

  if (data.AppId == "sh://VariableActuator.builtin") {
    act = new SmarthomeVariable(id, name, data, home);
  } else if(data.CssClassName == "heating") {
    act = new SmarthomeHeating(id, name, data, home);
  } else if(data.CssClassName == "light") {
    act = new SmarthomeLight(id, name, data, home);
  } else if(data.CssClassName == "elecDev") {
    act = new SmarthomeElectricalDevice(id, name, data, home);
  } else {
    act = new SmarthomeActuator(id, name, data, home);
    act.type = data.CssClassName;
  }
  log.debug("Created " + act + " of type " + act.type );
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
                          api.requestUpdate( self.id, function(error, device) {
                            callback(error, device.value);
                          } );
                        });
}

function SmarthomeConnection(request, body) {
  SmarthomeObject.call(this);

  this.connected = true;
  this.initialized = false;
  this.request = request;

  //console.log(body);

  var sidMatches = /sessionId\s*=\s*\"([a-zA-Z0-9]+)\"/.exec(body);
  if (!sidMatches) {
    var e = new SmarthomeError("Cannot parse sessionId from Smarthome response");
    throw(e);
  }
  this.sessionId = sidMatches[1];
  var lpMatches = /longPollingTimeoutSeconds\s*=\s*(\d+)/.exec(body);
  if (lpMatches) {
    var longPollingValue = lpMatches[1];
    this.longPollingTimeout = parseInt(longPollingValue) * 1000;
  } else {
    log.warn("Cannot parse longpollingTimeout from Smarthome response (using conservative default value 5 mins)");
    this.longPollingTimeout = 5 * 60000;
  }

  var $ = cheerio.load(body);

  //console.log(body);

  this.initializeLocations($);
  this.initializeDevices($);

  log.debug("Login to smarthome successfull");

  this.timeouts = 0;
  this.connectionErrors = 0;
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
      timeout: self.longPollingTimeout + ((self.timeouts+1) * 5000) },
      function (error, response, body) {
        if (!self.connected) return;
        if (error) {
          if (error.code == 'ETIMEDOUT') {
            self.timeouts++;
            log.info("Long polling timeout ("+self.timeouts+")");
            if (self.timeouts >= 5) {
              var e = new SmarthomeError("Too many (5) consecutive longpolling timeouts. Giving up.");
              self.emit("error", e);
              self.disconnect();
              return;
            }
            self.startLongPolling();
          } else if (error.code == 'ECONNREFUSED') {
            self.connectionErrors++;
            log.info("Connection refused during long polling ("+ self.connectionErrors + ")");
            if (self.connectionErrors >= 3) {
              var e = new SmarthomeError("Too many (3) consecutive longpolling errors. Giving up.");
              self.emit("error", e);
              self.disconnect();
              return;
            }
            setTimeout( function() { self.startLongPolling(); }, self.longPollingTimeout );
          } else {
            var e = new SmarthomeError("error during long polling request", error);
            self.emit("error", e);
            setTimeout( function() { self.startLongPolling(); }, self.longPollingTimeout );
          }
        } else if (response.statusCode == 200) {
          try {
            log.debug("Long polling response received");
            self.timeouts = 0;
            self.connectionErrors = 0;
            self.updateValues(body);
            self.startLongPolling();
          } catch (err) {
            var e = new SmarthomeError("unexpected response from long polling request", err, {type: "parseError" ,response: body});
            self.emit("error", e);
            self.disconnect();
          }
        } else {
          var e = new SmarthomeError("unexpected response from long polling request", null, {type: "httpStatusError" ,response: body, responseCode: response.statusCode});
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

      if (change.Type == "Logout") {
        log.warn("Received logout event from API");
        self.disconnect();
        return;
      } else if (change.Type && change.Type == "DeviceActivityFlushedNotification") {
        return;
      } else if (change.Type == "MessageState") {
        if (change.State == "deleted") {
          log.debug("Received MessageState change: " + change.State);
        } else {
          log.debug("Received MessageState change: " + change.State);
          log.debug(change);
          self.emit("message", change);
        }
      } else if (change.Type == "DeviceState") {
        log.info("Device state changed"); 
        log.debug(change);
        if (change.State == "InclusionPending") {
          /*
            {"Type":"DeviceState","State":"InclusionPending","IsReachable":true,"HasPendingConfigurationState":true,"Id":"72289c13-0dc4-4b90-8eb8-59e439e16916"}
           */
        } else {
          self.requestUpdate( change.Id )
        }
      } else if (change.IsResolveRequired) {
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
    if (callback) {
      callback( new SmarthomeError("Unexpected response to value update") );
    }
    if (change.message) {
      if (change.message == 'Session expired.') {
        log.warn("Received session expired message from API");
        self.disconnect();
      } else {
        self.emit("message",change.message);
      }
      return;
    }
    log.warn("Unknown response in SmarthomeConnection.prototype.updateValue (no id)");
    log.warn(change);
    return;
  }

  if (change.Id == "00000000-0000-0000-0000-000000000000" && change.Type == "NewMessage") {
    log.info("New message received");
    self.emit("message", "New message received");
    //TODO: How to fetch the real message
    if (callback) {
      callback( new SmarthomeError("Unexpected response to value update") );
    }
    return;
  }

  var device = self.device( change.Id );
  if (!device) {
    var e = new SmarthomeError("Received updated values for unknown device", null, {type: "invalidData", response: change});
    if (callback) {
      callback(e);
    } else {
      log.warn(e);
    }
    return;
  }
  var oldValue = device.value;
  device.lastUpdateMetadata = change.Metadata;
  device.parseValue(change.Value);

  if (callback) {
    callback(null, device, oldValue);
  }

}

SmarthomeConnection.prototype.disconnect = function(callback) {
  var self = this;
  self.connected = false;
  //Clean up all listeners
  _.each(self.devices, function(dev) {
    dev.removeAllListeners();
  });
  self.removeAllListeners();
  self.request( { url: LOGOUT_URL,
    followRedirect: true,
    followAllRedirects: true}, function() {
      self.emit("disconnect");
      if (callback) callback();
    });
}

SmarthomeConnection.prototype.location = function( id ) {
  var loc = _.findWhere(this.locations, {"id" : id} );
  if (loc) return loc;
  loc = _.findWhere(this.locations, {"name" : id} );
  if (loc) return loc;
  loc = _.find(this.locations, function(l) { return l.name.toLowerCase().indexOf(id.toLowerCase()) != -1 } );
  if (!loc) {
    log.error("Location " + id + " not found");
  }
  return loc;
}

SmarthomeConnection.prototype.exportCSV = function( callback ) {
  var self = this;
  self.request( { url: CSVEXPORT_URL,
    followRedirect: true,
    followAllRedirects: true,
    encoding: "utf16le"
  },
  function (error, response, body) {
    if (!self.connected) return;
    if (error) {
      self.emit("error", error);
      if (callback) { callback(error); };
    } else {
      if (callback) { callback(null, body); };
    }
  });
}

SmarthomeConnection.prototype.getMessages = function( callback ) {
  var self = this;
  self.request( { url: MESSAGE_URL,
    followRedirect: true,
    followAllRedirects: true
  },
  function (error, response, body) {
    if (!self.connected) return;
    if (error) {
      self.emit("error", error);
      if (callback) { callback(error); };
    } else {
      var $ = cheerio.load(body);
      messages = [];
      $(".message_list li").each( function(i, elem) {
        var msg = {}
        var li = $(this);
        msg.id=li.attr("id");
        msg.date=li.find(".date").text();
        msg.category=li.find(".category").text();
        msg.subject=li.find(".subject").text();
        msg.unread=li.find(".unread").length > 0;
        msg.url=li.find("a").attr("href");
        if (msg.subject) {
          messages.push( msg );
        }
      } );

      async.eachSeries(messages,
          function( msg, cb ) {
            if (!msg.url) {
              cb();
              return;
            }
            var details = SMARTHOME_ENDPOINT + msg.url;
            //console.log(details);
            self.request( { url: details,
              followRedirect: true,
              followAllRedirects: true
            }, function (error, response, body) {
              if (error) {
                self.emit("error", error);
                if (cb) { cb(error); };
              } else {
                var $ = cheerio.load(body);
                msg.message = $("#Message_Content").text().trim();
                cb();
              }
            });
          }, 
          function(err, results){
            if (!err && callback) { callback(null, messages); };
          });
    }
  });
}

SmarthomeConnection.prototype.sensor = findSensor; 
SmarthomeConnection.prototype.actuator = findActuator;
SmarthomeConnection.prototype.device = findDevice;

SmarthomeConnection.prototype.initializeLocations = function($) {
  var self = this;
  self.locations = [];
  var select = $(".dropdown-submenu").first();
  select.find("a").each( function(i, elem) {
    var option = $(this)
    var location_id = elem.attribs["location"].substring(2);
    var location_name = option.text();
    self.locations.push( new SmarthomeLocation(location_id, location_name, self) );
  } );
  if (self.locations.length === 0) {
    log.error("No locations found!");
  }
}

SmarthomeConnection.prototype.initializeDevices = function($) {
  var self = this;

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

  });

  _.each(actuatorData, function(element, index) {
      var location = self.location(element.LocationId);

      _.each(element.Actuators, function(data) {
        var actuator = SmarthomeActuator.create( data.Id, data.Name, data, self );
        actuator.location = location;
        location.actuators.push(actuator);
        self.actuators.push(actuator);

        actuator.parseValue(data.CurrentValue);

        _.each(element.BaseDeviceIds, function(device) {
          if (!self.baseDevices[device]) {
            self.baseDevices[device] = [];
          }
          self.baseDevices[device].push(actuator);
        } );

      });
  });

  self.devices = self.sensors.concat(self.actuators);

  //Initialization keeps track of which elements have been requested
  //and emits an event when values for all are received
  self.requestedDevices = 0;
  self.resolvedDevices = 0;
  _.each(self.devices, function(d) {
    if (d.value == null) { 
      self.requestedDevices++;
      log.info("Found device " + d + " (requesting value)");
      self.requestUpdate(d, function() {
        //error don't need to be handled here
        self.resolvedDevices ++;
        //check if all requested devices have been initialized yet
        //and if so, emit initialized event
        log.info("resolved value (" + self.resolvedDevices + " of "+ self.requestedDevices + ")");
        if (self.resolvedDevices === self.requestedDevices) {
          self.requestedDevices = 0;
          self.resolvedDevices = 0;
          self.initialized = true;
          self.emit('initialized');
          log.info("All devices initialized");
        }
      });
    } else {
      log.info("Found device " + d + " (" + d.displayValue()+")");
    }
  });

  if (self.requestedDevices == 0) {
    //if no values needed to be requested, we're good to go
    self.initialized = true;
    self.emit('initialized');
  }
}

/************* Helper functions ***********************/
function capitalize(string, lower) {
  return (lower ? string.toLowerCase() : string).replace(/(?:^|\s)\S/g, function(a) { return a.toUpperCase(); });
}

function parseResponseValue(value) {
  var newValue = null;

  if ( typeof(value) == 'undefined' || value == "undefined" || value == "null") {
    newValue = null;
  } else {
    newValue = ""+value;
    newValue = newValue.replace(",",".");
    newValue = newValue.replace("%","");
    newValue = newValue.replace("°","");
    if (newValue == "geöffnet") newValue=1;
    else if (newValue == "geschlossen") newValue=0;
    else if (newValue.match(/\d+(\.\d*)?/)) {
      newValue = parseFloat(newValue);
    }
  }

  return newValue;
}


/************* Exports ********************************/

module.exports = {
  SmarthomeConnection: SmarthomeConnection,
  SmarthomeError: SmarthomeError,
  Logger: log
};
