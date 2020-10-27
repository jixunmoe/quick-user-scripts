// ==UserScript==
// @name        lolesports - auto watch
// @namespace   uk.jixun
// @match       https://lolesports.com/*
// @grant       none
// @version     1.1.2
// @author      Jixun
// @license     MIT
// @description Auto watch/skip and get rewards.
// @run-at      document-start
// ==/UserScript==

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Change log
// v1.0        Initial version.
// v1.0.1      Broken stream detection (and skip if found).
// v1.1.0      Don't rely on class name detection provided in the APP, fetch them from the server instead.
// v1.1.1      Only mute if we enabled auto-play.
// v1.1.2      Auto-play with speed 1.5
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Constants
// Enter debug mode?
const debugHelper = false;

// Global variables
// Have we started?
let working = false;

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const getLogger = (() => {
  const LogLevel = {
    Debug: 0,
    Info: 1,
    Warn: 2,
    Error: 3,
    Off: 4,
  };

  const defaultLevel = LogLevel.Info;
  const baseStyle = 'border-radius:2px; padding:0 4px; color:white;';
  const levels = ['debug', 'info', 'warn', 'error'];

  const styles = [
    baseStyle + 'background:dodgerblue;',
    baseStyle + 'background:green;',
    baseStyle + 'background:orange;',
    baseStyle + 'background:red;'
  ];

  class Logger {
    constructor (label = '', level = defaultLevel) {
      this.label = label
      this.level = level
    }

    setLevel (levelLabel) {
      this.level = levels.indexOf(levelLabel);
    }

    print (level, messages) {
      const levelName = levels[level] || ''
      if (level >= this.level) {
        console.log('%c' + levelName, styles[level], this.label, '->', ...messages)
      }
    }

    debug (...args) {
      this.print(LogLevel.Debug, args)
    }

    info (...args) {
      this.print(LogLevel.Info, args)
    }

    warn (...args) {
      this.print(LogLevel.Warn, args)
    }

    error (...args) {
      this.print(LogLevel.Error, args)
    }
  }
  
  return (tag) => new Logger(tag, LogLevel.Info);
})();

const TAG = 'Aut0Watch3r';
const log = getLogger(TAG);

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function h(tag, attr, children) {
  const el = document.createElement(tag);
  // Object.assign(el, attr || {});
  Object.keys(attr || {}).forEach(key => {
    el.setAttribute(key, attr[key]);
  });
  Array.from(children || [], (child) => {
    if (typeof child === 'string') {
      child = document.createTextNode(child);
    }
    el.appendChild(child);
  });
  return el;
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

let __yt;
Object.defineProperty(window, 'YT', {
  get: () => __yt,
  set: (YT) => {
    __yt = YT;
    
    let playerFn;
    Object.defineProperty(YT, 'Player', {
      get: () => playerFn,
      set: (newPlayerFn) => {
        playerFn = function (a, b) {
          if (working) {
            Object.assign(document.getElementById(a).style, { width: '256px', height: '144px' });
            Object.assign(b || {}, { height: 144, width: 256 });
          }
          const player = new newPlayerFn(a, b);
          if (working) {
            player.addEventListener('onReady', () => {
              player.mute();
              player.setPlaybackRate(1.5);
            });
          }
          return player;
        };
        Object.assign(playerFn, newPlayerFn);
      }
    });
  }
});

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Hook raf fn to keep events called in background.

const raf = window.requestAnimationFrame;
const caf = window.cancelAnimationFrame;
window.requestAnimationFrame = fn => {
  if (working) {
    // simulate 10fps
    return setTimeout(fn, 100);
  } else {
    return raf(fn);
  }
};
window.cancelAnimationFrame = id => {
  caf(id);
  clearTimeout(id);
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LOL eSports - React Web APP API/Modules

let router;
let relApi;
let rewardsWatchHistory;

// React Router Redirect
function redirect(path) {
  if (router) {
    router.redirect(path);
  }
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Icons from css.gg
const iconSvg = {
  'play-button-o': `<svg
  width="24"
  height="24"
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
>
  <path
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M12 21C16.9706 21 21 16.9706 21 12C21 7.02944 16.9706 3 12 3C7.02944 3 3 7.02944 3 12C3 16.9706 7.02944 21 12 21ZM12 23C18.0751 23 23 18.0751 23 12C23 5.92487 18.0751 1 12 1C5.92487 1 1 5.92487 1 12C1 18.0751 5.92487 23 12 23Z"
    fill="currentColor"
  />
  <path d="M16 12L10 16.3301V7.66987L16 12Z" fill="currentColor" />
</svg>`
};

document.head.appendChild(h('style', null, [`

.jx-auto-play {
  padding-top: 28px;
  cursor: pointer;
}

button.gg-icon {
  background: transparent;
  color: inherit;
  border: 0;
  cursor: pointer;

  width: 24px;
  height: 24px;
}

.gg-icon:disabled {
  opacity: 0.3;
}

.jx-spin {
  animation: jx-spin 3s linear infinite;
}

@keyframes jx-spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

`]));

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

function injectToWebPack() {
  return new Promise((resolve) => {
    const id = `jixun: ${Math.random()}`;
    const CHUNK_MAIN = 3;
    (window.webpackJsonp = window.webpackJsonp || []).push([
      [/* Inject to Webpack Runtime :D */],
      {
      [id]: function (module, exports, require) {
        const idx = webpackJsonp.findIndex(x => x[1][id]);
        webpackJsonp.splice(idx, 1);
        resolve([module, exports, require]);
      },
      },
      [[id, CHUNK_MAIN]]
    ]);
  });
}

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));
const sleep5m = () => sleep(5 * 60 * 1000);

/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// vods { [matchId]: { startTime, games, ... } }
const vods = new Map();
const tournaments = new Map();

async function fetchTournamentId(matchId) {
  const tournamentDetails = await relApi.fetchEventDetails(matchId);
  return tournamentDetails.tournament.id;
}

async function getTournamentVods(tid) {
  if (tournaments.has(tid)) {
    return tournaments.get(tid) || null;
  }
  const tVods = [...await relApi.fetchVods(tid)].map((vod) => ({
    ...vod,
    tid,
    startTime: new Date(vod.startTime),
  })).sort((a, b) => b.startTime - a.startTime);
  tournaments.set(tid, tVods);
  return tVods;
}

async function fetchVods(matchId) {
  if (vods.has(matchId)) {
    return vods.get(matchId) || null;
  }
  
  const tid = await fetchTournamentId(matchId);
  const tVods = await getTournamentVods(tid);
  for (const vod of tVods) {
    vods.set(vod.match.id, vod);
  }

  return vods.get(matchId) || null;
}

async function fetchMatchInfo(matchId) {
  const vod = await fetchVods(matchId);
  if (!vod) return null;
  return [vod.games, vod.tid];
}

function splitVodUrl(url) {
  const [, matchId, gameId] = url.match(/\/vod\/(\d+)\/(\d+)/);
  return [matchId, gameId];
}

async function autoPlayVideo(url) {
  const [matchId, gameId] = splitVodUrl(url);
  const [matchInfo, tid] = await fetchMatchInfo(matchId);
  
  if (!matchInfo) {
    log.warn('could not find any info for ' + matchId);
    return null;
  }
  
  const videoId = matchInfo[gameId - 1].id;
  log.info('start: videoId: ' + videoId + '; matchId: ' + matchId);

  router.redirect(url);

  // Check if we have the parameter.
  await sleep(5 * 1000);
  // If we are on the right track, we should have "parameter" injected to current url.
  if (!/^\/vod\/\d+\/\d\/.{3,}$/.test(location.pathname)) {
    log.error('could not find video parameter in URL (failed to fetch stream?), skip.');
    return;
  }

  // For each video, try 30 mins max.
  let success = false;
  for(let i = 0; i < 6; i++) {
    await sleep5m();

    // invalidate cache
    rewardsWatchHistory.reset();
    const watchHistory = await rewardsWatchHistory.fetchWatchHistory(tid);
    if (watchHistory[videoId]) {
      success = true;
      break;
    }
    log.info('not ready, wait...');
  }

  if (success) {
    log.info('video reward ok. Take a break before next video...');
    await sleep5m();    
  } else {
    log.error('could not get video reward for this video. skip.');
  }
}

function getIcon(name) {
  const el = h('i', { 'class': `gg-icon gg-${name}` });
  el.innerHTML = iconSvg[name];
  return el;
}

function getIconButton(name) {
  const el = h('button', { 'class': `gg-icon gg-${name}`, 'type': 'button' });
  el.innerHTML = iconSvg[name];
  return el;
}

const identity = x => x;
function $$(selector, map = identity) {
  return Array.from(document.querySelectorAll(selector), map);
}

async function getVodLinksForRewards() {
  const games = $$('.VodsList .VodsGameSelector');
  if (games.length === 0) {
    return [];
  }

  // The first game of the last "Best Of N" in the last of the list, must be able to query its tournament id
  const url = games[games.length - 1].querySelector('a.game').getAttribute('href');
  const [matchId] = splitVodUrl(url);

  const tid = await fetchTournamentId(matchId);
  const tVods = await getTournamentVods(tid);
  const watchHistory = await rewardsWatchHistory.fetchWatchHistory(tid);
  const vodForRewards = [];
  
  for(const vod of tVods) {
    for(const [i, game] of vod.games.entries()) {
      // Needs to be completed for VOD watch.
      if (game.state !== 'completed' || game.vods.length === 0) break;

      // Reward for this vod already claimed
      if (watchHistory[game.id]) break;

      vodForRewards.push(`/vod/${vod.match.id}/${i + 1}`);
    }
  }

  return vodForRewards;
}

function main() {
  const autoPlayIcon = getIconButton('play-button-o');
  const autoWatchMenu = h('section', {
    'class': 'riotbar-navmenu-right-icon jx-auto-play'
  }, [autoPlayIcon]);
  autoPlayIcon.onclick = async () => {
    const links = await getVodLinksForRewards();
    
    if (links.length === 0) {
      alert('Nothing to watch.\nNavigate to one of the "VODS" page!');
      return;
    }
    
    log.info('links to auto play: \n' + links.join('\n'));
    if (!confirm(`${links.length} videos to watch, continue?`)) {
      return;
    }
    
    working = true;
    autoPlayIcon.classList.add('jx-spin');
    autoPlayIcon.disabled = true;
    
    for(let url of links) {
      await autoPlayVideo(url);
    }
    
    working = false;
    autoPlayIcon.classList.remove('jx-spin');
    autoPlayIcon.disabled = false;
  };
  
  const icons = document.querySelector('.riotbar-right-content-icons');
  icons.appendChild(autoWatchMenu);
}

async function bootstrap() {
  const [module, exports, require] = await injectToWebPack();
  let left = 3;
  for (let i = 0; i < 100 && left > 0; i++) {
    for (const [_, value] of Object.entries(require(i))) {
      if (value && value.routes && value.redirect) {
        console.info('found router');
        left--;
        router = value;
        break;
      } else if (value && value.fetchTournaments) {
        console.info('found relApi');
        left--;
        relApi = value;
        break;
      } else if (value && value && value.fetchWatchHistory) {
        console.info('found rewardsWatchHistory');
        left--;
        rewardsWatchHistory = value;
      }
    }
  }

  if (debugHelper) {
    window.jxExports = { router, relApi, rewardsWatchHistory, require };
  }
  
  return Boolean(router && relApi && rewardsWatchHistory && require);
}

window.addEventListener('load', async () => {
  if (await bootstrap()) {
    main();
  } else {
    alert("failed to initialise!\ncheck console for more info");
  }
});
