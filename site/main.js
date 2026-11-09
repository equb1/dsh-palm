(function () {
  'use strict';

  var root = document.documentElement;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------- toast */
  var toastEl = document.getElementById('toast');
  var toastTimer = 0;

  function toast(message) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      toastEl.classList.remove('is-visible');
    }, 2200);
  }

  /* ---------------------------------------------------------------- theme */
  var themeButton = document.getElementById('theme-toggle');
  var themeLabel = themeButton ? themeButton.querySelector('.theme-label') : null;
  var themeIconUse = themeButton ? themeButton.querySelector('use') : null;
  var modes = ['auto', 'light', 'dark'];
  var labels = { auto: '自动', light: '浅色', dark: '深色' };
  var titles = { auto: '跟随系统', light: '浅色模式', dark: '深色模式' };

  function currentTheme() {
    var value = root.dataset.theme;
    return value === 'light' || value === 'dark' ? value : 'auto';
  }

  function applyTheme(mode, persist) {
    root.dataset.theme = mode;
    if (themeLabel) themeLabel.textContent = labels[mode];
    if (themeButton) {
      themeButton.setAttribute('aria-label', '切换配色：' + titles[mode]);
      themeButton.title = titles[mode];
    }
    if (themeIconUse) {
      themeIconUse.setAttribute('href', mode === 'dark' ? '#i-sun' : '#i-moon');
    }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', mode === 'dark' ? '#0c0e14' : '#141C31');
    if (persist) {
      try { localStorage.setItem('jinang-theme', mode); } catch (error) { /* private mode */ }
    }
  }

  if (themeButton) {
    applyTheme(currentTheme(), false);
    themeButton.addEventListener('click', function () {
      var index = modes.indexOf(currentTheme());
      applyTheme(modes[(index + 1) % modes.length], true);
    });
  }

  /* ---------------------------------------------------------------- seeds */
  var seedButtons = Array.prototype.slice.call(document.querySelectorAll('[data-seed]'));
  var seeds = ['indigo', 'emerald', 'amber', 'violet'];

  function applySeed(seed, persist) {
    if (seeds.indexOf(seed) === -1) seed = 'indigo';
    root.dataset.seed = seed;
    seedButtons.forEach(function (button) {
      var active = button.getAttribute('data-seed') === seed;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (persist) {
      try { localStorage.setItem('jinang-seed', seed); } catch (error) { /* private mode */ }
    }
  }

  applySeed(root.dataset.seed || 'indigo', false);
  seedButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      applySeed(button.getAttribute('data-seed'), true);
    });
  });

  /* ----------------------------------------------------------- hero demos */
  var demoTabs = Array.prototype.slice.call(document.querySelectorAll('[data-demo-tab]'));
  var demoScreens = Array.prototype.slice.call(document.querySelectorAll('[data-demo]'));
  var enginePill = document.getElementById('engine-pill');
  var engineNames = { light: '轻引擎', proot: '完整引擎', pet: '轻引擎', lan: '轻引擎' };
  var floatEngine = document.getElementById('float-engine');
  var floatNames = { light: '轻引擎 · 已就绪', proot: '完整引擎 · 已就绪', pet: '桌宠 · 在线', lan: '轻引擎 · 已就绪' };

  function showDemo(name) {
    demoTabs.forEach(function (tab) {
      var active = tab.getAttribute('data-demo-tab') === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    demoScreens.forEach(function (screen) {
      var active = screen.getAttribute('data-demo') === name;
      screen.classList.toggle('is-active', active);
      screen.hidden = !active;
    });
    if (enginePill) {
      var label = enginePill.querySelector('span');
      if (label) label.textContent = engineNames[name] || '轻引擎';
    }
    if (floatEngine) {
      var text = floatEngine.querySelector('.float-engine-text');
      if (text) text.textContent = floatNames[name] || '轻引擎 · 已就绪';
    }
  }

  demoTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      showDemo(tab.getAttribute('data-demo-tab'));
    });
  });

  /* ------------------------------------------------------ approval card */
  var approvalCard = document.getElementById('approval-card');
  var approvalResult = document.getElementById('approval-result');

  function resolveApproval(approved) {
    if (!approvalCard || !approvalResult) return;
    approvalCard.hidden = true;
    approvalResult.hidden = false;
    if (approved) {
      approvalResult.innerHTML = '已生成周报，包含本周进展、风险与下周计划。' +
        '<span class="file-chip"><svg class="icon"><use href="#i-doc"/></svg>docx · 周报.docx</span>';
      toast('已允许写入 · 周报已生成');
    } else {
      approvalResult.innerHTML = '已拒绝写入，原文件没有改动。需要时可以再让我试一次。';
      toast('已拒绝 · 文件保持不变');
    }
  }

  if (approvalCard) {
    approvalCard.addEventListener('click', function (event) {
      var button = event.target.closest('[data-approval]');
      if (!button) return;
      resolveApproval(button.getAttribute('data-approval') === 'approve');
    });
  }

  /* ------------------------------------------------------------- pet data */
  var PETS = {
    deepy: {
      name: 'Deepy',
      captions: {
        working: '正在敲代码：这一轮的每个工具调用，它都跟着动。',
        thinking: '四芒星转起来：模型在梳理思路，桌宠也在挠头。',
        attention: '审批卡一出现，它就举手等你拍板。',
        juggling: '任务完成，来一个空翻。',
        sleeping: '空闲 60 秒后自动睡着；戳一下会醒。',
        idle: '没任务时发呆，偶尔在屏幕上溜达。'
      },
      bubbles: {
        working: '正在干活…马上就好',
        thinking: '让我想想…',
        attention: '等你确认一下',
        juggling: '搞定！',
        sleeping: 'Zzz…',
        idle: '在呢。',
        'react-tickle': '哈哈，好痒'
      }
    },
    maid: {
      name: '鲸娘',
      captions: {
        working: '正在敲代码：鲸娘也跟着这一轮任务一起忙。',
        thinking: '四芒星转起来：她托着腮帮子帮你梳理思路。',
        attention: '审批卡一出现，她就举手等你拍板。',
        juggling: '任务完成，鲸娘给你来个空翻。',
        sleeping: '空闲 60 秒后自动睡着；戳一下会醒。',
        idle: '没任务时发呆，偶尔在屏幕上溜达。'
      },
      bubbles: {
        working: '正在干活…马上就好',
        thinking: '让我想想…',
        attention: '等你确认一下',
        juggling: '搞定！',
        sleeping: 'Zzz…',
        idle: '在呢。',
        'react-tickle': '哈哈，好痒'
      }
    }
  };

  var DURATIONS = {
    working: 720,
    thinking: 1200,
    attention: 960,
    juggling: 640,
    sleeping: 1760,
    idle: 1120,
    'react-tickle': 640
  };

  function restartAnimation(el) {
    if (reduceMotion) return;
    el.style.animation = 'none';
    // 强制回流，让同一个 sprite 的状态切换也能重新播放
    void el.offsetWidth;
    el.style.animation = '';
  }

  /* ------------------------------------------------------- phone pet demo */
  var phonePet = document.getElementById('phone-pet');
  var phonePetChips = Array.prototype.slice.call(document.querySelectorAll('[data-phone-pet-state]'));
  var phonePetBubble = phonePet ? phonePet.parentElement.querySelector('.pet-bubble') : null;
  var phonePetState = 'working';

  function setPhonePet(pet, state) {
    if (!phonePet) return;
    phonePet.setAttribute('data-pet', pet);
    phonePet.setAttribute('data-state', state);
    phonePet.style.setProperty('--pet-size', '118px');
    phonePet.style.setProperty('--pet-duration', DURATIONS[state] + 'ms');
    phonePet.style.backgroundImage = 'url("assets/pets/' + pet + '/' + state + '.png")';
    phonePet.style.animationIterationCount = state === 'juggling' || state === 'react-tickle' ? '1' : 'infinite';
    restartAnimation(phonePet);
    if (phonePetBubble) phonePetBubble.textContent = PETS[pet].bubbles[state] || '';
    phonePetChips.forEach(function (chip) {
      chip.classList.toggle('is-active', chip.getAttribute('data-phone-pet-state') === state);
    });
  }

  phonePetChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      phonePetState = chip.getAttribute('data-phone-pet-state');
      setPhonePet(labPetType, phonePetState);
    });
  });

  /* ---------------------------------------------------------- pet lab */
  var labPet = document.getElementById('lab-pet');
  var labBubble = document.getElementById('lab-bubble');
  var labCaption = document.getElementById('pet-caption');
  var stageLabel = document.getElementById('stage-label');
  var petTypeButtons = Array.prototype.slice.call(document.querySelectorAll('[data-pet-type]'));
  var petStateButtons = Array.prototype.slice.call(document.querySelectorAll('[data-pet-state]'));
  var labPetType = 'deepy';
  var labPetState = 'working';
  var labReturnState = 'working';

  function setLabPet(pet, state, options) {
    options = options || {};
    if (!labPet) return;
    labPetType = pet;
    labPetState = state;
    labPet.setAttribute('data-pet', pet);
    labPet.setAttribute('data-state', state);
    labPet.style.setProperty('--pet-size', options.size || '');
    labPet.style.setProperty('--pet-duration', DURATIONS[state] + 'ms');
    labPet.style.backgroundImage = 'url("assets/pets/' + pet + '/' + state + '.png")';
    labPet.style.animationIterationCount = state === 'juggling' || state === 'react-tickle' ? '1' : 'infinite';
    restartAnimation(labPet);

    if (labBubble) labBubble.textContent = PETS[pet].bubbles[state] || '';
    if (labCaption) labCaption.textContent = PETS[pet].captions[state] || '';
    if (stageLabel) stageLabel.textContent = pet + ' · ' + state;

    petTypeButtons.forEach(function (button) {
      var active = button.getAttribute('data-pet-type') === pet;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    petStateButtons.forEach(function (button) {
      var active = button.getAttribute('data-pet-state') === state;
      button.classList.toggle('is-active', active);
    });

    if (!options.keepPhone) setPhonePet(pet, phonePetState);
  }

  petTypeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      setLabPet(button.getAttribute('data-pet-type'), labPetState);
    });
  });

  petStateButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var state = button.getAttribute('data-pet-state');
      if (state !== 'react-tickle') labReturnState = state;
      setLabPet(labPetType, state);
    });
  });

  if (labPet) {
    labPet.addEventListener('animationend', function () {
      if (labPetState === 'juggling' || labPetState === 'react-tickle') {
        setLabPet(labPetType, labReturnState === 'react-tickle' ? 'working' : labReturnState);
      }
    });
  }

  var pokeButton = document.getElementById('poke-pet');
  if (pokeButton) {
    pokeButton.addEventListener('click', function () {
      setLabPet(labPetType, 'react-tickle', { keepPhone: true });
    });
  }

  /* ------------------------------------------------------- release meta */
  function formatBytes(bytes) {
    if (!bytes) return '—';
    var mb = bytes / (1024 * 1024);
    return mb.toFixed(1) + ' MB';
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    var copied = false;
    try { copied = document.execCommand('copy'); } catch (error) { copied = false; }
    area.remove();
    return copied;
  }

  var releaseFile = document.getElementById('release-file');
  var releaseSize = document.getElementById('release-size');
  var releaseSha = document.getElementById('release-sha');
  var releaseVersion = document.getElementById('release-version');
  var downloadApk = document.getElementById('download-apk');
  var shaButton = document.getElementById('sha-copy');
  var releaseData = null;

  fetch('assets/release.json', { cache: 'no-store' })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (!data) return;
      releaseData = data;
      if (releaseVersion && data.version) releaseVersion.textContent = 'v' + data.version;
      if (releaseFile && data.file) releaseFile.textContent = data.file;
      if (releaseSize) releaseSize.textContent = formatBytes(data.size);
      if (releaseSha) releaseSha.textContent = data.sha256 ? data.sha256.slice(0, 16) + '…' : '构建产物';
      if (shaButton && data.sha256) {
        shaButton.title = '点击复制完整 SHA-256';
        shaButton.setAttribute('aria-label', '复制完整 SHA-256');
      }
      if (downloadApk) {
        downloadApk.href = data.assetUrl || downloadApk.href;
        if (data.file) downloadApk.setAttribute('download', data.file);
      }
    })
    .catch(function () { /* 落地页在没有 release.json 时仍可用 */ });

  if (shaButton) {
    shaButton.addEventListener('click', function () {
      var value = releaseData && releaseData.sha256;
      if (!value) {
        toast('构建产物生成后才有 SHA-256');
        return;
      }
      copyText(value).then(function (copied) {
        toast(copied ? 'SHA-256 已复制' : '复制失败，请手动选择');
      });
    });
  }

  /* --------------------------------------------------------- copy buttons */
  var copyButtons = Array.prototype.slice.call(document.querySelectorAll('.copy-btn[data-copy]'));
  copyButtons.forEach(function (button) {
    var original = button.innerHTML;
    button.addEventListener('click', function () {
      var selector = button.getAttribute('data-copy');
      var target = selector ? document.querySelector(selector) : null;
      var text = target ? target.textContent.replace(/\s+$/, '') : '';
      if (!text) return;
      copyText(text).then(function (copied) {
        button.classList.toggle('copied', copied);
        button.innerHTML = copied ? '<svg class="icon"><use href="#i-check"/></svg>已复制' : '复制失败';
        window.setTimeout(function () {
          button.innerHTML = original;
          button.classList.remove('copied');
        }, 1800);
      });
    });
  });

  /* ------------------------------------------------------------- stars */
  var starCount = document.getElementById('star-count');
  if (starCount) {
    fetch('https://api.github.com/repos/equb1/dsh-palm', { headers: { Accept: 'application/vnd.github+json' } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || typeof data.stargazers_count !== 'number') return;
        starCount.textContent = new Intl.NumberFormat('zh-CN').format(data.stargazers_count);
      })
      .catch(function () {
        if (starCount.textContent === '—') starCount.textContent = 'Star';
      });
  }

  /* ------------------------------------------------------- download note */
  Array.prototype.forEach.call(document.querySelectorAll('a[data-download]'), function (link) {
    link.addEventListener('click', function () {
      toast('正在打开 GitHub Releases…');
    });
  });

  /* -------------------------------------------------------------- reveal */
  var revealTargets = Array.prototype.slice.call(document.querySelectorAll(
    '.section-head, .bento > *, .pet-lab, .arch, .download-card, .build-grid, .docs, .limit-grid, .star-cta'
  ));
  revealTargets.forEach(function (el, index) {
    el.classList.add('reveal');
    el.style.transitionDelay = Math.min(index % 6, 5) * 55 + 'ms';
  });

  if ('IntersectionObserver' in window && !reduceMotion) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    revealTargets.forEach(function (el) { observer.observe(el); });
  } else {
    revealTargets.forEach(function (el) { el.classList.add('is-in'); });
  }

  /* ------------------------------------------------------- initial pet */
  setLabPet('deepy', 'working');
})();
