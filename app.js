/**
 * Calipso, a NodeJS CMS
 *
 * This file is the core application launcher.  See app-cluster for visibility
 * of how the application should be run in production mode
 *
 * Usage:  node app, or NODE_ENV=production node app
 *
 */

var req = require('express/lib/request');

 var flashFormatters = req.flashFormatters = {
   s: function(val){
     return String(val);
   }
 };

 /**
  * Queue flash `msg` of the given `type`.
  *
  * Examples:
  *
  *      req.flash('info', 'email sent');
  *      req.flash('error', 'email delivery failed');
  *      req.flash('info', 'email re-sent');
  *      // => 2
  *
  *      req.flash('info');
  *      // => ['email sent', 'email re-sent']
  *
  *      req.flash('info');
  *      // => []
  *
  *      req.flash();
  *      // => { error: ['email delivery failed'], info: [] }
  *
  * Formatting:
  *
  * Flash notifications also support arbitrary formatting support.
  * For example you may pass variable arguments to `req.flash()`
  * and use the %s specifier to be replaced by the associated argument:
  *
  *     req.flash('info', 'email has been sent to %s.', userName);
  *
  * To add custom formatters use the `exports.flashFormatters` object.
  *
  * @param {String} type
  * @param {String} msg
  * @return {Array|Object|Number}
  * @api public
  */

  function miniMarkdown(str){
    return String(str)
      .replace(/(__|\*\*)(.*?)\1/g, '<strong>$2</strong>')
      .replace(/(_|\*)(.*?)\1/g, '<em>$2</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  };

 req.flash = function(type, msg){
   if (this.session === undefined) throw Error('req.flash() requires sessions');
   var msgs = this.session.flash = this.session.flash || {};
   if (type && msg) {
     var i = 2
       , args = arguments
       , formatters = this.app.flashFormatters || {};
     formatters.__proto__ = flashFormatters;
     msg = miniMarkdown(msg);
     msg = msg.replace(/%([a-zA-Z])/g, function(_, format){
       var formatter = formatters[format];
       if (formatter) return formatter(utils.escape(args[i++]));
     });
     return (msgs[type] = msgs[type] || []).push(msg);
   } else if (type) {
     var arr = msgs[type];
     delete msgs[type];
     return arr || [];
   } else {
     this.session.flash = {};
     return msgs;
   }
 };

var sys;
try {
  sys = require('util');
} catch (e) {
  sys = require('sys');
}

var rootpath = process.cwd() + '/',
  path = require('path'),
  fs = require('fs'),
  express = require('express'),
  nodepath = require('path'),
  stylus = require('stylus'),
  colors = require('colors'),
  calipso = require(path.join(rootpath, 'lib/calipso')),
  translate = require(path.join(rootpath, 'i18n/translate')),
  logo = require(path.join(rootpath, 'logo')),
  everyauth = require("everyauth");

var conf = {
  google: {
    clientId: '3335216477.apps.googleusercontent.com',
    clientSecret: 'PJMW_uP39nogdu0WpBuqMhtB'
  }
  , fb: {
        appId: '111565172259433'
      , appSecret: '85f7e0a0cc804886180b887c1f04a3c1'
    }
  , twit: {
        consumerKey: 'JLCGyLzuOK1BjnKPKGyQ'
      , consumerSecret: 'GNqKfPqtzOcsCtFbGTMqinoATHvBcy1nzCTimeA9M0'
    }
};

everyauth.debug = true;

everyauth.everymodule
  .findUserById( function (req, id, callback) {
    var User = calipso.db.model('User');
    User.findById(id, function (err, user) {
      req.session.user = user;
      callback(err, user);
    });
  });

function calipsoFindOrCreateUser(username, promise) {
  var User = calipso.db.model('User');
  function finishUser(sess, user) {
    if (!sess._pending) return promise.fulfill(user);
    return calipso.lib.user.createUserSession(sess._pending, null, user, function(err) {
      if(err) { calipso.error("Error saving session: " + err); return promise.fail(err); }
      promise.fulfill(user);
    });
  }
  
  User.findOne({username:username}, function (err, user) {
    if (err) return promise.fail(err);
    if (user) return promise.fulfill(user);
    var u = new User({
      username: 'google:' + googleUser.email,
      fullname: googleUser.name,
      email: googleUser.email,
      hash: 'external:auth'
    });
    u.roles = ['Guest']; // Todo - need to make sure guest role can't be deleted?
    
    calipso.e.pre_emit('USER_CREATE',u);

    u.save(function(err) {
      if (err) return promise.fail(err);
      calipso.e.post_emit('USER_CREATE',u);
      // If not already redirecting, then redirect
      finishUser(sess, u);
    });
  });
  return promise;
}

// Local App Variables
var path = rootpath,
    theme = 'default',
    port = process.env.PORT || 3000;

/**
 * Catch All exception handler
 */
//process.on('uncaughtException', function (err) {
//  console.log('Uncaught exception: ' + err + err.stack);
//});

/**
 *  App settings and middleware
 *  Any of these can be added into the by environment configuration files to
 *  enable modification by env.
 */
function bootApplication(next) {

  // Create our express instance, export for later reference
  var app = express();
  app.path = function() { return path };
  app.isCluster = false;

  // Load configuration
  var Config = calipso.configuration; //require(path + "/lib/core/Config").Config;
  app.config = new Config();
  app.config.init(function(err) {

    if(err) return console.error(err.message);

    // Default Theme
    calipso.defaultTheme = app.config.get('themes:default');

    app.use(express.bodyParser());
    // Pause requests if they were not parsed to allow PUT and POST with custom mime types
    app.use(function (req, res, next) { if (!req._body) { req.pause(); } next(); });
    app.use(express.methodOverride());
    app.use(express.cookieParser(app.config.get('session:secret')));
    app.use(express.responseTime());

    // Create dummy session middleware - tag it so we can later replace
    var temporarySession = app.config.get('installed') ? {} : express.session({ secret: "installing calipso is great fun" });
    temporarySession.tag = "session";
    app.use(temporarySession);
    
    // Create holders for theme dependent middleware
    // These are here because they need to be in the connect stack before the calipso router
    // THese helpers are re-used when theme switching.
    app.mwHelpers = {};

    calipso.auth = {password: app.config.get('server:authentication:password')};

    var appId = app.config.get('server:authentication:facebookAppId');
    var appSecret = app.config.get('server:authentication:facebookAppSecret');    
    if (appId && appSecret) {
      calipso.auth.facebook = true;
      everyauth
        .facebook
          .appId(appId)
          .appSecret(appSecret)
          .findOrCreateUser( function (session, accessToken, accessTokenExtra, fbUserMetadata) {
            console.log(fbUserMetadata);
          })
          .redirectPath('/');
    }
    
    var consumerKey = app.config.get('server:authentication:twitterConsumerKey');
    var consumerSecret = app.config.get('server:authentication:twitterConsumerSecret');
    if (consumerKey && consumerSecret) {
      calipso.auth.twitter = true;
      everyauth
        .twitter
          .consumerKey(consumerKey)
          .consumerSecret(consumerSecret)
          .findOrCreateUser( function (sess, accessToken, accessSecret, twitUser) {
            console.log(twitUser);
          })
          .redirectPath('/');
    }
  
    var clientId = app.config.get('server:authentication:googleClientId');
    var clientSecret = app.config.get('server:authentication:googleClientSecret');
    if (clientId && clientSecret) {
      calipso.auth.google = true;
      everyauth.google
        .appId(clientId)
        .appSecret(clientSecret)
        .scope('https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email')
        .getSession( function (req) {
          if (!req.session)
            req.session = { _pending: req };
          return req.session;
        })
        .findOrCreateUser( function (sess, accessToken, extra, googleUser) {
          googleUser.refreshToken = extra.refresh_token;
          googleUser.expiresIn = extra.expires_in;
          
          var promise = this.Promise();
      
          return calipsoFindOrCreateUser('google:' + googleUser.email, promise);
        })
        .redirectPath('/');
    }
    
    app.use(everyauth.middleware());

    console.log(calipso.auth);
    
    // Load placeholder, replaced later
    if(app.config.get('libraries:stylus:enabled')) {
      if ((fs.existsSync || path.existsSync)(themePatch + '/stylus')) {
        app.mwHelpers.stylusMiddleware = function (themePath) {
          var mw = stylus.middleware({
            src: themePath + '/stylus',
            dest: themePath + '/public',
            debug: false,
            compile: function (str, path) { // optional, but recommended
              return stylus(str)
                .set('filename', path)
                .set('warn', app.config.get('libraries:stylus:warn'))
                .set('compress', app.config.get('libraries:stylus:compress'));
            }
          });
          mw.tag = 'theme.stylus';
          return mw;
        };
        app.use(app.mwHelpers.stylusMiddleware(''));
      }
    }
    // Static
    app.mwHelpers.staticMiddleware = function (themePath) {
      var mw = express["static"](themePath + '/public', {maxAge: 86400000});
      mw.tag = 'theme.static';
      return mw;
    };
    // Load placeholder, replaced later
    app.use(app.mwHelpers.staticMiddleware(''));

    // Core static paths
    app.use(express["static"](path + '/media', {maxAge: 86400000}));
    app.use(express["static"](path + '/lib/client/js', {maxAge: 86400000}));

    // Translation - after static, set to add mode if appropriate
    app.use(translate.translate(app.config.get('i18n:language'), app.config.get('i18n:languages'), app.config.get('i18n:additive')));

    // Core calipso router
    calipso.init(app, function() {

      // Add the calipso mw
      app.use(calipso.routingFn());

      // return our app refrerence
      next(app);

    })

  });

}

/**
 * Initial bootstrapping
 */
exports.boot = function (cluster, next) {

  // Bootstrap application
  bootApplication(next);

};

// allow normal node loading if appropriate
// e.g. not called from app-cluster or bin/calipso
if (!module.parent) {

  logo.print();

  exports.boot(false, function (app) {

    if (app) {
      var out = app.listen(port, function () {
        console.log("Calipso version: ".green + app.about.version);
        console.log("Calipso configured for: ".green + (global.process.env.NODE_ENV || 'development') + " environment.".green);
        if (app.address)
          console.log("Calipso server listening on port: ".green + app.address().port);
        else
          console.log("Calipso server listening on port: ".green + port);
      });
      process.nextTick(function () {
        if (out && out.address && out.address().port !== port)
          console.log("Calipso server listening on port: ".red + out.address().port);
      });
    } else {
      console.log("\r\nCalipso terminated ...\r\n".grey);
      process.exit();
    }

  });

}
