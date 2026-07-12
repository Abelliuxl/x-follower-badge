// ==UserScript==
// @name         X 用户名旁显示粉丝数
// @namespace    https://github.com/liuxiaoliang
// @version      1.2.0
// @description  在 X 时间线、搜索结果和推文详情的用户名旁显示粉丝数
// @homepageURL  https://github.com/Abelliuxl/x-follower-badge
// @supportURL   https://github.com/Abelliuxl/x-follower-badge/issues
// @downloadURL  https://raw.githubusercontent.com/Abelliuxl/x-follower-badge/main/x-follower-badge.user.js
// @updateURL    https://raw.githubusercontent.com/Abelliuxl/x-follower-badge/main/x-follower-badge.user.js
// @match        https://x.com/*
// @match        https://twitter.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(() => {
  'use strict';

  const QUERY_ID = '1VOOyvKkiI3FMmkeDNxM9A';
  const BEARER_TOKEN =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  const CACHE_TTL = 30 * 60 * 1000;
  const FAILURE_TTL = 60 * 1000;
  const MIN_REQUEST_GAP = 700;
  const cache = new Map();
  const failureUntil = new Map();
  const inflight = new Map();
  const queue = [];
  let activeRequests = 0;
  let lastRequestAt = 0;
  let scanTimer = 0;
  const observedLinks = new WeakMap();

  const EXCLUDED_PATHS = new Set([
    'compose', 'explore', 'home', 'i', 'jobs', 'messages', 'notifications',
    'search', 'settings', 'tos', 'privacy', 'login', 'logout', 'signup'
  ]);

  GM_addStyle(`
    .xfb-badge {
      color: rgb(83, 100, 113);
      display: inline-block;
      flex: 0 0 auto;
      font-size: 0.82em;
      font-weight: 400;
      margin-left: 0.35em;
      position: relative;
      top: 2px;
      white-space: nowrap;
    }
    .xfb-nowrap-row {
      flex-wrap: nowrap !important;
      min-width: 0;
      white-space: nowrap;
    }
    html[style*="color-scheme: dark"] .xfb-badge { color: rgb(113, 118, 123); }
  `);

  function cookie(name) {
    const prefix = `${name}=`;
    return document.cookie.split('; ').find((item) => item.startsWith(prefix))
      ?.slice(prefix.length) || '';
  }

  function formatCount(count) {
    return new Intl.NumberFormat(document.documentElement.lang || 'zh-CN', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(count);
  }

  function readCache(username) {
    const item = cache.get(username.toLowerCase());
    if (!item || Date.now() - item.time > CACHE_TTL) return null;
    return item.count;
  }

  function enqueue(task) {
    return new Promise((resolve) => {
      queue.push({ task, resolve });
      drainQueue();
    });
  }

  function drainQueue() {
    while (activeRequests < 1 && queue.length) {
      const { task, resolve } = queue.shift();
      activeRequests += 1;
      task().then(resolve, () => resolve(null)).finally(() => {
        activeRequests -= 1;
        drainQueue();
      });
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function waitForRequestSlot() {
    const wait = MIN_REQUEST_GAP - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  }

  async function requestFollowers(username) {
    const key = username.toLowerCase();
    const cached = readCache(key);
    if (cached !== null) return cached;
    if ((failureUntil.get(key) || 0) > Date.now()) return null;
    if (inflight.has(key)) return inflight.get(key);

    const promise = enqueue(async () => {
      const variables = JSON.stringify({
        screen_name: username,
        withSafetyModeUserFields: true,
      });
      const features = JSON.stringify({
        hidden_profile_subscriptions_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
      });
      const url = `/i/api/graphql/${QUERY_ID}/UserByScreenName?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;
      const csrf = decodeURIComponent(cookie('ct0'));
      const headers = {
        authorization: `Bearer ${BEARER_TOKEN}`,
        'x-twitter-active-user': 'yes',
        'x-twitter-client-language': document.documentElement.lang || 'zh-cn',
      };
      if (csrf) {
        headers['x-csrf-token'] = csrf;
        headers['x-twitter-auth-type'] = 'OAuth2Session';
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await waitForRequestSlot();
        const response = await fetch(url, { credentials: 'include', headers });
        if (response.ok) {
          const json = await response.json();
          const result = json?.data?.user?.result;
          const count = result?.legacy?.followers_count ?? result?.core?.followers_count;
          if (!Number.isFinite(count)) throw new Error('响应中没有 followers_count');
          cache.set(key, { count, time: Date.now() });
          failureUntil.delete(key);
          return count;
        }

        if (response.status !== 429 && response.status < 500) {
          throw new Error(`HTTP ${response.status}`);
        }
        const retryAfter = Number(response.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 3000 * (attempt + 1);
        console.info(`[X Follower Badge] @${username} 遇到 HTTP ${response.status}，${delay / 1000} 秒后重试`);
        await sleep(delay);
      }
      throw new Error('多次重试后仍然失败');
    }).catch((error) => {
      failureUntil.set(key, Date.now() + FAILURE_TTL);
      console.warn(`[X Follower Badge] @${username} 获取失败：`, error);
      return null;
    }).finally(() => inflight.delete(key));

    inflight.set(key, promise);
    return promise;
  }

  function usernameFromLink(link) {
    const path = new URL(link.href, location.href).pathname.split('/').filter(Boolean);
    if (path.length !== 1) return null;
    const username = path[0];
    if (!/^[A-Za-z0-9_]{1,15}$/.test(username) || EXCLUDED_PATHS.has(username.toLowerCase())) return null;
    return username;
  }

  function findHost(link) {
    const userName = link.closest('[data-testid="User-Name"]');
    if (!userName) return null;
    // @用户名所在的链接通常是最稳定、最不影响原布局的挂载位置。
    return [...userName.querySelectorAll('a[href]')].find((item) =>
      (item.textContent || '').trim().startsWith('@')
    ) || link;
  }

  async function processLink(link) {
    const username = usernameFromLink(link);
    const host = username && findHost(link);
    if (!host) return;

    const userNameBox = host.closest('[data-testid="User-Name"]');
    const oldBadge = userNameBox?.querySelector('.xfb-badge');
    if (oldBadge?.dataset.username === username.toLowerCase()) return;
    oldBadge?.remove();
    if (host.dataset.xfbLoading === username.toLowerCase()) return;

    host.dataset.xfbLoading = username.toLowerCase();
    const count = await requestFollowers(username);
    if (!host.isConnected || host.dataset.xfbLoading !== username.toLowerCase()) return;
    delete host.dataset.xfbLoading;
    if (count === null) return;

    const badge = document.createElement('span');
    badge.className = 'xfb-badge';
    badge.dataset.username = username.toLowerCase();
    badge.textContent = `· ${formatCount(count)} 粉丝`;
    badge.title = `${count.toLocaleString()} 位粉丝`;
    // X 将 @用户名放在一个宽度受限的内层容器中。把徽标放到时间链接后，
    // 即“用户名 + 时间”的外层横排里，避免徽标独占第二行。
    const timeLink = userNameBox?.querySelector('time')?.closest('a');
    const insertionPoint = timeLink || host;
    insertionPoint.parentElement?.classList.add('xfb-nowrap-row');
    insertionPoint.insertAdjacentElement('afterend', badge);
  }

  function scan(root = document) {
    root.querySelectorAll?.('[data-testid="User-Name"] a[href^="/"]').forEach((link) => {
      const href = link.getAttribute('href');
      if (observedLinks.get(link) === href) return;
      observedLinks.set(link, href);
      visibilityObserver.observe(link);
    });
  }

  // 只请求视口附近的用户，避免打开长评论区时瞬间请求所有账号。
  const visibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      visibilityObserver.unobserve(entry.target);
      processLink(entry.target);
    });
  }, { rootMargin: '600px 0px' });

  scan();
  new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = window.setTimeout(() => scan(), 180);
  }).observe(document.body, {
    attributes: true,
    attributeFilter: ['href'],
    childList: true,
    subtree: true,
  });
})();
