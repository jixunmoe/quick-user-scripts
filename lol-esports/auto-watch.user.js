// ==UserScript==
// @name        lolesports - auto watch
// @namespace   uk.jixun
// @match       https://lolesports.com/*
// @grant       none
// @version     1.0.1
// @author      Jixun
// @license     MIT
// @description Auto watch/skip and get rewards.
// @run-at      document-start
// ==/UserScript==

////////////////////////////////////////////////////////////
// Change log
// v1.0        Initial version.
// v1.0.1      Broken stream detection (and skip if found).
////////////////////////////////////////////////////////////

// Enter debug mode?
const debugHelper = false;

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

const eventAppNavigate = `${TAG}-${Math.random()}`;
(() => {
  const replaceState = history.replaceState;

  history.replaceState = (function (state, title, url) {
    const event = new CustomEvent(eventAppNavigate, { detail: { state, title, url } });
    window.dispatchEvent(event);

    return replaceState.apply(this, arguments);
  }).bind(history);

  window.addEventListener(eventAppNavigate, ({detail: {state, title, url}}) => {
    log.info("location: " + document.location + ", url: " + url + ", state: " + JSON.stringify(state));
  });
})();


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

// vods {
//   [tournamentId]: tournament
// }
const vods = new Map();

const sleep = (t) => new Promise(resolve => setTimeout(resolve, t));
const sleep5m = () => sleep(5 * 60 * 1000);

async function fetchMatchInfo(matchId) {
  for(const [tid, tVid] of vods) {
    for(const t of tVid) {
      if (t.match.id === matchId) {
        return [t.games, tid];
      }
    }
  }
  
  // Not found, we need to update our information...
  log.info('Get tournament information...');
  const tournamentDetails = await relApi.fetchEventDetails(matchId);
  const tid = tournamentDetails.tournament.id;
  const tVod = await relApi.fetchVods(tid);
  vods.set(tid, tVod);
  
  for(const t of tVod) {
    if (t.match.id === matchId) {
      return [t.games, tid];
    }
  }
  
  return null;
}

async function autoPlayVideo(url) {
  const [, matchId, gameId] = url.match(/\/vod\/(\d+)\/(\d+)/);
  const [matchInfo, tid] = await fetchMatchInfo(matchId);
  
  if (!matchInfo) {
    log.warn('could not find any info for ' + matchId);
    return null;
  }
  
  const videoId = matchInfo[gameId - 1].id;
  log.info('start: videoId: ' + videoId + '; matchId: ' + matchId);

  router.redirect(url);

  // Check if we have the parameter.
  await sleep(30 * 1000);
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
    rewardsWatchHistory.watchHistoryPromise = null;
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

// Have we started?
let working = false;

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
          player.addEventListener('onReady', () => {
            player.mute();
          });
          return player;
        };
        Object.assign(playerFn, newPlayerFn);
      }
    });
  }
});

function main() {
  const autoPlayIcon = getIconButton('play-button-o');
  const autoWatchMenu = h('section', {
    'class': 'riotbar-navmenu-right-icon jx-auto-play'
  }, [autoPlayIcon]);
  autoPlayIcon.onclick = async () => {
    const links = $$('.VodsGameSelector .game:not(.not-played):not(.watched)', x => x.href.replace(/^.+?com\//, '/'));
    
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
