# node-sonos-controller
node-sonos-controller

A client for https://github.com/jishi/node-sonos-http-api<br>
<br>
Control Sonos to play a Favorite Song to completion<br>
Optionally play text-to-speech when song is interrupted<br>

## Pseudo-Code :

```
  getSong();
  playFavoriteSong();

  while (songNotDone()) {
	if paused()
      unPause()
	if lowVolume()
	  setVolume()
	if muted()
	  unMute()
	if largeSeek()
	  reseek()
	if stopped()
	  shame()
	if wrongSong()
	  shame()
  }
  shame() {
    playShame();
    playFavoriteSong();
  }
```

## Setup :

Clone and run this : https://github.com/jishi/node-sonos-http-api

Add your Favorite Song to Sonos Favorites

http://www.sonos.com/support/onlineuserguide/en/SonosUserGuide/CONTROL_EN/Sonos_Favorites_-_CONTROL.htm

You will also need to provide Sonos Zone Name (as seen in Sonos Client or node-sonos-http-api://zones)

Clone this: https://github.com/lazyevil/node-sonos-controller

npm install

## Usage :

```
node index.js -h

Options:
  -s, --song    Favorite Song Name                        [string] [default: ""]
  -z, --zone    Sonos Zone Name                     [string] [default: "Shared"]
  -v, --volume  Volume Level (0-100)                    [string] [default: "25"]
  -H, --host    node-sonos-http-api hostname     [string] [default: "localhost"]
  -p, --port    node-sonos-http-api port number       [string] [default: "5005"]
  -t, --text    Play Text To Speech when song is stopped or skipped [string] [default: ""]
  -d, --debug   Enable debug output                   [boolean] [default: false]
  -q, --quiet   Disable log output                    [boolean] [default: false]
  -D, --dryrun  Sonos control dry run                 [boolean] [default: false]
  -r, --repeat  Repeat indefinitely                   [boolean] [default: false]
  -h, --help    Show help                             [boolean] [default: false]
```

### Examples :

Play favorite song "Brazil", say "Shame" if stopped or skipped

```
node index.js -s Brazil -t Shame

  app:info Set Volume: 25 +1ms
  app:info Playing Brazil +0ms
  app:shame Playing wrong song! +12s
  app:shame Shame! +1ms
  app:info Playing Brazil +0ms
  app:shame Muted! +7s
  app:info UnMuting.. +0ms
```
