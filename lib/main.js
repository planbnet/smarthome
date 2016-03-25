var fs = require('fs');
var Smarthome = require('./api.js');
var SmarthomeConnection = Smarthome.SmarthomeConnection;
var SmarthomeError = Smarthome.SmarthomeError;
var log = Smarthome.Logger;

var request = require('request')
var ForeverAgent = require('forever-agent');
var cheerio = require('cheerio')

var SMARTHOME_ENDPOINT = 'https://mobile.rwe-smarthome.de'
var LOGIN_FORM_URL = SMARTHOME_ENDPOINT + '/MobileWeb/Logon/Logon'
var LOGIN_URL = SMARTHOME_ENDPOINT + '/MobileWeb/Logon'
var CONTROL_URL = SMARTHOME_ENDPOINT + '/MobileWeb/OverviewAndControl'

function SmarthomeAPI() {
  this.Logger = Smarthome.Logger;
}

SmarthomeAPI.prototype.connect = function(username, password, callback) {
  var self = this;
  var cookies = request.jar();
  var pool = new ForeverAgent();
  var http = request.defaults({
    pool: pool,
    jar: cookies,
    followAllRedirects: true
  })

  log.debug("Fetching " + LOGIN_FORM_URL);
  http(LOGIN_FORM_URL, function (error, response, body) {
    if (!error) {
      var $ = cheerio.load(body);
      var token = $("input[name=__RequestVerificationToken]").val();
      //cookies.setCookie( request.cookie("cookies.CookiesEnabled=true"), SMARTHOME_ENDPOINT );
      //cookies.setCookie( request.cookie("windowHeight=1104"), SMARTHOME_ENDPOINT );
      //cookies.setCookie( request.cookie("windowWidth=1920"), SMARTHOME_ENDPOINT );

      if (!token) {
        log.error (body);
        callback(new SmarthomeError("No Token found in response", null, {body: body}), null);
      } else {
        self.login(http, username, password, token, callback);
      }
    } else {
      callback(new SmarthomeError("Could not connect endpoint at " + LOGIN_URL, error), null);
    }
  })
}

SmarthomeAPI.prototype.setLogLevel = function(level) {
  log.setLevel(level);
}

SmarthomeAPI.prototype.login = function(http, username, password, token, callback) {
  log.debug("Logging in to " + LOGIN_URL + " as " + username + " with token " + token);
  http.post(LOGIN_URL, {
      form: {
        'LanguageDropDown'           : 'Deutsch',
        'UserName'                   : username,
        'Password'                   : password,
        'RememberMe'                 : 'true',
        '__RequestVerificationToken' : token,
        'ReturnUrl'                  : '%2fMobileWeb%2fOverviewAndControl'
      }
  }, function (error, response, body) {
        //console.log(body);
        if (!error) {
          if (response.statusCode != 200) {
            callback(new SmarthomeError("Could not create SmarthomeConnection", null, {response: body}));
            return;
          }

          log.debug("Fetching " + CONTROL_URL);
          http(CONTROL_URL, function (error, response, body) {
            if (!error) {
              if (response.statusCode != 200) {
                callback(new SmarthomeError("Could not load overview", null, {response: body}));
                return;
              }
              var conn = null;
              try {
                conn = new SmarthomeConnection(http, body);
              } catch (e) {
                log.debug(e);
                log.error(e.stack)
                callback(new SmarthomeError("Could not create SmarthomeConnection", e));
                return;
              }
              callback( null, conn );
            } else {
              callback(new SmarthomeError("Could not load overview at " + CONTROL_URL, error), null);
            }
          });
        } else {
          callback(new SmarthomeError("Could not create SmarthomeConnection", error));
        }
      });
}

module.exports = new SmarthomeAPI();
