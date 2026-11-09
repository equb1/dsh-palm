(function () {
  'use strict';

  var root = document.documentElement;
  var themeButton = document.getElementById('theme-toggle');
  var themeLabel = themeButton ? themeButton.querySelector('.theme-label') : null;
  var modes = ['auto', 'light', 'dark'];
  var labels = { auto: '跟随系统', light: '浅色', dark: '深色' };

  function currentTheme() {
    return root.dataset.theme === 'light' || root.dataset.theme === 'dark' ? root.dataset.theme : 'auto';
  }

  function applyTheme(mode) {
    root.dataset.theme = mode;
    if (themeLabel) {
      themeLabel.textContent = labels[mode];
    }
    if (themeButton) {
      themeButton.setAttribute('aria-label', '切换配色：' + labels[mode]);
    }
    try {
      localStorage.setItem('jinang-theme', mode);
    } catch (error) {
      /* Storage can be unavailable in private browsing. */
    }
  }

  if (themeButton) {
    applyTheme(currentTheme());
    themeButton.addEventListener('click', function () {
      var index = modes.indexOf(currentTheme());
      applyTheme(modes[(index + 1) % modes.length]);
    });
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
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    area.remove();
    return copied;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () {
        return true;
      }).catch(function () {
        return fallbackCopy(text);
      });
    }
    return Promise.resolve(fallbackCopy(text));
  }

  var copyButtons = document.querySelectorAll('.copy-btn[data-copy]');
  Array.prototype.forEach.call(copyButtons, function (button) {
    button.addEventListener('click', function () {
      var selector = button.getAttribute('data-copy');
      var target = selector ? document.querySelector(selector) : null;
      var text = target ? target.textContent.replace(/\s+$/, '') : '';
      if (!text) {
        return;
      }
      copyText(text).then(function (copied) {
        var original = button.textContent;
        button.textContent = copied ? '已复制' : '复制失败';
        button.classList.toggle('copied', copied);
        window.setTimeout(function () {
          button.textContent = original;
          button.classList.remove('copied');
        }, 1800);
      });
    });
  });

  var downloadNote = document.getElementById('download-note');
  var downloadLinks = document.querySelectorAll('a[data-download]');
  Array.prototype.forEach.call(downloadLinks, function (link) {
    link.addEventListener('click', function () {
      if (!downloadNote) {
        return;
      }
      var original = downloadNote.getAttribute('data-original') || downloadNote.textContent;
      downloadNote.setAttribute('data-original', original);
      downloadNote.textContent = '正在打开 GitHub Releases…';
      window.setTimeout(function () {
        downloadNote.textContent = original;
      }, 3000);
    });
  });
})();
