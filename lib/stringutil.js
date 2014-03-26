var util = {};

util.capitalize = function(string)
{
 return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

module.exports = util;
