var request = require('request')
var SmarthomeConnection = require('./api.js')
var cheerio = require('cheerio')

var SMARTHOME_ENDPOINT = 'https://mobile.rwe-smarthome.de'
var LOGIN_URL = SMARTHOME_ENDPOINT + '/MobileWeb/Logon/Logon'

function SmarthomeAPI() { }

SmarthomeAPI.prototype.connect = function( username, password, callback ) {
  var self = this;
  var cookies = request.jar();
  var http = request.defaults({
    jar: cookies,
    followAllRedirects: true
  })

  http(LOGIN_URL, function (error, response, body) {
    if (!error) {
      var $ = cheerio.load(body);
      var token = $("input[name=__RequestVerificationToken]").val();
      if (!token) {
        callback( {"message": "No Token found in response", "body": body}, null);
      } else {
        self.login(http, username, password, token, callback);
      }
    } else {
      callback( {"message": "Could not connect endpoint at " + LOGIN_URL,
                 "body": body,
                 "cause": error}, null );
    }
  })
}

SmarthomeAPI.prototype.login = function( http, username, password, token, callback ) {
  http.post(LOGIN_URL, {
      form: {
        'LanguageDropDown'           : 'Deutsch',
        'UserName'                   : username,
        'Password'                   : password,
        'RememberMe'                 : 'true',
        '__RequestVerificationToken' : token,
        'ReturnUrl'                  : ''
      } }, function (error, response, body) {
        if (!error) {
          var conn = null;
          try {
            conn = new SmarthomeConnection(http, body);
          } catch (e) {
            //callback( e, null );
            throw e;
            return;
          }
          callback( null, new SmarthomeConnection(http, body) );
        } else {
          error.body = body;
          callback( error, null );
        }
      });
}

module.exports = new SmarthomeAPI();
