var http = require('http');
var _ = require('underscore');
var yargs = require('yargs')
var settings = yargs
    .option('s', {
        alias: 'song',
        default: '',
        demand: false,
        describe: 'Favorite Song Name',
        type: 'string'
    })
    .option('z', {
        alias: 'zone',
        demand: false,
        default: 'Shared',
        describe: 'Sonos Zone Name',
        type: 'string'
    })
    .option('v', {
        alias: 'volume',
        demand: false,
        default: '25',
        describe: 'Volume Level (0-100)',
        type: 'string'
    })
    .option('H', {
        alias: 'host',
        demand: false,
        default: 'localhost',
        describe: 'node-sonos-http-api hostname',
        type: 'string'
    })
    .option('p', {
        alias: 'port',
        demand: false,
        default: '5005',
        describe: 'node-sonos-http-api port number',
        type: 'string'
    })
    .option('t', {
        alias: 'text',
        demand: false,
        default: '',
        describe: 'Play Text To Speech when song is stopped or skipped',
        type: 'string'
    })
    .option('d', {
        alias: 'debug',
        demand: false,
        default: false,
        describe: 'Enable debug output',
        type: 'boolean'
    })
    .option('q', {
        alias: 'quiet',
        demand: false,
        default: false,
        describe: 'Disable log output',
        type: 'boolean'
    })
    .option('D', {
        alias: 'dryrun',
        default: false,
        demand: false,
        describe: 'Sonos control dry run',
        type: 'boolean'
    })
    .option('r', {
        alias: 'repeat',
        default: false,
        demand: false,
        describe: 'Repeat indefinitely',
        type: 'boolean'
    })
    .option('h', {
        alias: 'help',
        default: false,
        demand: false,
        describe: 'Show help',
        type: 'boolean'
    })
    .argv;


var Favorite = function(settings) {
    var that = this;
    that.initDebug(settings);

    // node-sonos-http-api location
    that.options = {
        host: settings.host,
        port: settings.port
    };
    // Sonos Settings
    that.zoneName = settings.zone; // Name of Sonos Zone
    that.minVolume = settings.volume; // Volume Setting

    // Control Settings
    that.shameText = settings.text;
    that.isDryRun = settings.dryrun;
    that.repeat = settings.repeat;

    // Tunable parameters
    that.shameSleepSeconds = 5; // Seconds to sleep after Shaming
    that.playSleepSeconds = 3; // Seconds to sleep after Playing
    that.seekSleepSeconds = 2; // Seconds to sleep after Seeking
    that.maxSeekSkipSeconds = 5; // Maximum track skip time allowed without Re-seek()ing
    that.pollIntervalMilliseconds = 500; // How frequently to poll node-sonos-http-api state
    that.throttleMilliseconds = 3000; // Minimum amount of time between node-sonos-http-api play song requests

    // Init song state
    that.setSongState({
        name: settings.song,
        playStarted: false,
        internalPlayTime: 0,
        externalPlayTime: 0,
        length: 0
    });

    that.throttledPlay = _.throttle(that.playSong.bind(that), that.throttleMilliseconds, {
        trailing: false
    });

    return that;
}

Favorite.prototype.initDebug = function(settings) {
    var that = this;

    if (settings.help) {
        yargs.showHelp();
        process.exit(0);
    }

    // Info level logging by default
    process.env.DEBUG = 'app:info,app:error,app:shame';

    // Enable all debug if requested
    if (settings.d) {
        process.env.DEBUG = '*';
    }

    // Enable quiet if requested
    if (settings.q) {
        process.env.DEBUG = '';
    } else {
        yargs.showHelp();
    }

    var debug = require('debug');
    that.log = {
        debug: debug('app:debug'),
        shame: debug('app:shame'),
        error: debug('app:error'),
        info: debug('app:info')
    };

    that.log.info("Starting");
    if (settings.d) {
        that.log.debug("Debug enabled");
    }
    return that;
}

// Start Playing Favorite Song
Favorite.prototype.play = function() {
    var that = this;
    that.setVolume();
    that.pollState();
    that.updatePlayTime();
    return that;
}

// Internal sleep timer (do not controlState while sleeping)
Favorite.prototype.sleep = function(seconds) {
    var that = this;
    if (!_.isUndefined(seconds)) {
        that.sleepTime = seconds;
    } else {
        that.log.debug("Sleeping : " + that.sleepTime);
        that.sleepTime--;
    }
    if (that.sleepTime > 0) {
        setTimeout(that.sleep.bind(that), 1000);
    } else {
        that.log.debug("Done sleeping");
    }
    return that;
}

// Control Sonos to play Favorite Song
Favorite.prototype.controlState = function(status) {
    var that = this;

    if (!_.isUndefined(that.sleepTime) && that.sleepTime > 0) {
        // that.log.debug("sleeping..");
        return;
    }

    // Confirm valid Sonos Status
    if (!_.isUndefined(status.error)) {
        that.log.error("Wrong sonos zone name?");
        that.log.error(status);
        process.exit(1);
    }

    // Confirm player is not Muted
    if (status.mute != false) {
        that.log.shame("Muted!");
        that.unMute();
    }

    // Confirm volume is not dropped
    if (status.volume < that.minVolume) {
        that.log.shame("Volume dropped!");
        that.setVolume();
    }

    // Confirm not paused
    if (that.isPaused(status)) {
        that.log.shame("Paused!");
        return that.resumePlay();

        // Confirm not stopped
    } else if (that.isStopped(status)) {
        that.log.shame('Stopped!');
        return that.shame();
    }

    // Confirm correct song is playing
    else if (!_.isEmpty(that.song.name) && status.currentTrack.title != that.song.name) {
        that.log.shame("Playing wrong song!");
        return that.shame();
    }

    // Confirm song is not being skipped through
    else if (that.song.externalPlayTime > 0 && Math.abs(status.elapsedTime - that.song.externalPlayTime) > that.maxSeekSkipSeconds) {
        that.log.shame("Detected skipping!");
        that.trackSeek(that.song.externalPlayTime);
    } else {
        // Correct song is playing
        that.setSongState({
            internalPlayTime: status.elapsedTime,
            externalPlayTime: status.elapsedTime,
            playStarted: status.elapsedTime > 0,
            name: _.isEmpty(that.song.name) ? status.currentTrack.title : that.song.name,
            artist: _.isEmpty(that.song.artist) ? status.currentTrack.artist : that.song.artist,
            length: status.currentTrack.duration
        });
    }
    return that;
}

Favorite.prototype.isPaused = function(status) {
    if (status.zoneState == 'PAUSED_PLAYBACK' || status.playerState == 'PAUSED_PLAYBACK') {
        return true;
    }
    return false;
}

Favorite.prototype.isStopped = function(status) {
    if (status.zoneState == 'STOPPED' || status.playerState == 'STOPPED') {
        return true;
    }
    return false;
}

// Update Internal Song State
Favorite.prototype.setSongState = function(state) {
    var that = this;
    if (_.isUndefined(that.song)) {
        that.song = {};
    }
    var currentSongName = that.song.name;
    that.song = _.extend(that.song, state);
    if (!_.isEmpty(that.song.name) && that.song.name != currentSongName) {
        that.log.info("Detected Song '" + that.song.name + "' by '" + that.song.artist + "'");
    }
    that.log.debug("Song play time is " + that.song.internalPlayTime);
    return that;
}

// Make request to node-sonos-http-api
Favorite.prototype.sonosRequest = function(options, callback) {
    var that = this;
    if (that.isDryRun && options.path.indexOf('/state') < 0) {
        that.log.debug("Dry Run");
        that.log.debug(options);
        if (!_.isUndefined(callback)) {
            callback(null); // XXX
        }
        return;
    }
    var request = http.request(options, callback);
    request.end();
    request.on('error', function(err) {
        that.log.error(options);
        that.log.error(err);
        process.exit(1);
    });
}

// Poll node-sonos-http-api state
Favorite.prototype.pollState = function() {
    var that = this;
    that.sonosRequest(_.extend(that.options, {
            path: '/' + that.zoneName + '/state'
        }),
        function(response) {
            var str = ''
            response.on('data', function(chunk) {
                str += chunk;
            });

            response.on('end', function() {
                if (!_.isEmpty(str)) {
                    that.controlState(JSON.parse(str));
                }
            });
        }
    );

    // Continue polling if song not completed
    if (that.song.length == 0 || that.song.internalPlayTime < that.song.length) {
        setTimeout(that.pollState.bind(that), that.pollIntervalMilliseconds);
    } else {
        // Song has played for required duration
        that.log.info("Song played!");
        if (!that.repeat) {
            process.exit(0);
        }
        that.setSongState({
            playStarted: false,
            internalPlayTime: 0,
            externalPlayTime: 0,
            length: 0
        });
        that.sleep(that.playSleepSeconds);
        setTimeout(that.pollState.bind(that), that.pollIntervalMilliseconds);
    }
    return that;
}

// Update internal wall clock
Favorite.prototype.updatePlayTime = function() {
    var that = this;
    if (that.song.externalPlayTime > 0) {
        that.song.internalPlayTime++;
    }
    setTimeout(that.updatePlayTime.bind(that), 1000);
    return that;
}

// Play the song (replace queue, put the Favorite on)
Favorite.prototype.playSong = function() {
    var that = this;
    if (_.isEmpty(that.song.name)) {
        that.log.error("Indeterminate song.");
        process.exit(1);
    }
    that.log.info("Playing " + that.song.name);
    that.sonosRequest(_.extend(that.options, {
        path: '/' + that.zoneName + '/favorite/' + that.song.name
    }));
    that.setSongState({
        internalPlayTime: 0,
        externalPlayTime: 0,
        playStarted: true
    });
    that.sleep(that.playSleepSeconds);
    return that;
}

// UnPause
Favorite.prototype.resumePlay = function() {
    var that = this;
    that.log.info("Resume Playing " + that.song.name)
    that.sonosRequest(_.extend(that.options, {
        path: '/' + that.zoneName + '/play'
    }));
    return that;
}

// UnMute
Favorite.prototype.unMute = function() {
    var that = this;
    that.log.info("UnMuting..");
    that.sonosRequest(_.extend(that.options, {
        path: '/' + that.zoneName + '/unmute'
    }));
    return that;
}

// Reset Volume
Favorite.prototype.setVolume = function() {
    var that = this;
    that.log.info("Set Volume: " + that.minVolume);
    that.sonosRequest(_.extend(that.options, {
        path: '/' + that.zoneName + '/volume/' + that.minVolume
    }));
    return that;
}

// Seek to point in Song
Favorite.prototype.trackSeek = function(time) {
    var that = this;
    that.log.info("Seeking to: " + time);
    that.sonosRequest(_.extend(that.options, {
        path: '/' + that.zoneName + '/trackseek/' + time
    }));
    that.sleep(that.seekSleepSeconds);
    return that;
}

// Play "Shame" via Text-To-Speech, followed by Favorite Song
Favorite.prototype.shame = function() {
    var that = this;
    if (!that.song.playStarted || _.isEmpty(that.shameText)) {
        that.log.shame("No shame.");
        that.throttledPlay();
        return that;
    }

    that.log.shame("Shame!");
    that.sonosRequest(_.extend(that.options, {
        path: '/' + that.zoneName + '/say/' + encodeURIComponent(that.shameText)
    }));
    that.sleep(that.shameSleepSeconds);
    setTimeout(that.throttledPlay.bind(that), that.shameSleepSeconds * 1000);

    return that;
}

// Start here.
new Favorite(settings).play();
