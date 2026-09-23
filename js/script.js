/* ==========================================================================
   Pointer Creek Wealth Management — site behaviour
   Vanilla JS, no dependencies. Progressive: everything degrades gracefully.
   ========================================================================== */
(function () {
  'use strict';

  /* ---- Header: solid background after scrolling past the top ---- */
  var header = document.querySelector('.site-header');
  function onScroll() {
    if (!header) return;
    if (window.scrollY > 40) header.classList.add('is-solid');
    else header.classList.remove('is-solid');
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---- Mobile nav toggle ---- */
  var toggle = document.querySelector('.nav-toggle');
  var nav = document.querySelector('.nav');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // close menu when a real link is tapped
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        toggle.classList.remove('open');
      });
    });
  }

  /* ---- Dropdown: tap-to-open on small screens ---- */
  document.querySelectorAll('.nav-item > span').forEach(function (label) {
    label.addEventListener('click', function () {
      if (window.innerWidth <= 860) {
        label.parentElement.classList.toggle('open');
      }
    });
  });

  /* ---- Mark the active nav link based on current file ---- */
  (function () {
    var here = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav a[href], .nav .nav-item[data-match]').forEach(function (el) {
      var target = el.getAttribute('href') || el.getAttribute('data-match');
      if (target === here) el.classList.add('active');
    });
  })();

  /* ---- Hero slideshow ---- */
  var hero = document.querySelector('.hero');
  if (hero) {
    var slides = Array.prototype.slice.call(hero.querySelectorAll('.hero-slide'));
    var dots = Array.prototype.slice.call(hero.querySelectorAll('.hero-dots button'));
    var current = 0, timer = null;

    function go(i) {
      current = (i + slides.length) % slides.length;
      slides.forEach(function (s, n) { s.classList.toggle('active', n === current); });
      dots.forEach(function (d, n) { d.classList.toggle('active', n === current); });
    }
    function next() { go(current + 1); }
    function prev() { go(current - 1); }
    function start() { stop(); timer = setInterval(next, 6000); }
    function stop() { if (timer) clearInterval(timer); }

    var nextBtn = hero.querySelector('.hero-arrow.next');
    var prevBtn = hero.querySelector('.hero-arrow.prev');
    if (nextBtn) nextBtn.addEventListener('click', function () { next(); start(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { prev(); start(); });
    dots.forEach(function (d, n) { d.addEventListener('click', function () { go(n); start(); }); });

    if (slides.length > 1) { go(0); start(); }
    else if (slides.length === 1) { slides[0].classList.add('active'); }
  }

  /* ---- Rolling carousel (Life Situations, etc.) ---- */
  document.querySelectorAll('[data-roller]').forEach(function (roller) {
    var viewport = roller.querySelector('.roller-viewport');
    var track = roller.querySelector('.roller-track');
    var cards = Array.prototype.slice.call(track.querySelectorAll('.life-card'));
    var prevBtn = roller.querySelector('.roller-arrow.prev');
    var nextBtn = roller.querySelector('.roller-arrow.next');
    var dotsWrap = roller.querySelector('.roller-dots');
    if (!track || cards.length === 0) return;

    var index = 0, perView = 1, maxIndex = 0, step = 0, timer = null;

    function measure() {
      var cardW = cards[0].getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(track).columnGap || getComputedStyle(track).gap || '18') || 18;
      step = cardW + gap;
      perView = Math.max(1, Math.round(viewport.clientWidth / step));
      maxIndex = Math.max(0, cards.length - perView);
      if (index > maxIndex) index = maxIndex;
      buildDots();
      render();
    }

    function buildDots() {
      if (!dotsWrap) return;
      dotsWrap.innerHTML = '';
      for (var i = 0; i <= maxIndex; i++) {
        (function (i) {
          var b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('aria-label', 'Go to slide ' + (i + 1));
          b.addEventListener('click', function () { index = i; render(); restart(); });
          dotsWrap.appendChild(b);
        })(i);
      }
    }

    function render() {
      track.style.transform = 'translateX(' + (-index * step) + 'px)';
      if (prevBtn) prevBtn.disabled = index <= 0;
      if (nextBtn) nextBtn.disabled = index >= maxIndex;
      if (dotsWrap) {
        Array.prototype.forEach.call(dotsWrap.children, function (d, n) {
          d.classList.toggle('active', n === index);
        });
      }
    }

    function go(i) { index = Math.max(0, Math.min(maxIndex, i)); render(); }
    function advance() { index = index >= maxIndex ? 0 : index + 1; render(); }
    function start() { stop(); if (maxIndex > 0) timer = setInterval(advance, 5000); }
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function restart() { start(); }

    if (nextBtn) nextBtn.addEventListener('click', function () { go(index + 1); restart(); });
    if (prevBtn) prevBtn.addEventListener('click', function () { go(index - 1); restart(); });
    roller.addEventListener('mouseenter', stop);
    roller.addEventListener('mouseleave', start);

    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(measure, 150); }, { passive: true });

    measure();
    start();
  });

  /* ---- Life-situation detail modal ---- */
  (function () {
    var modal = document.getElementById('lifeModal');
    if (!modal) return;
    var content = modal.querySelector('.life-modal-content');
    var box = modal.querySelector('.life-modal-box');
    var lastFocus = null;

    function open(card) {
      var h4 = card.querySelector('h4');
      var detail = card.querySelector('.life-detail');
      if (!detail) return;
      content.innerHTML = '';
      if (h4) {
        var title = h4.cloneNode(true);
        title.id = 'lifeModalTitle';
        content.appendChild(title);
      }
      var clone = detail.cloneNode(true);
      clone.removeAttribute('hidden');
      content.appendChild(clone);
      lastFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('modal-open');
      box.setAttribute('tabindex', '-1');
      box.focus();
    }
    function close() {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    document.querySelectorAll('.life-card').forEach(function (card) {
      card.addEventListener('click', function () { open(card); });
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(card); }
      });
    });
    modal.querySelectorAll('[data-close]').forEach(function (el) {
      el.addEventListener('click', close);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modal.hidden) close();
    });
  })();

  /* ---- FAQ accordion ---- */
  document.querySelectorAll('.faq-item').forEach(function (item) {
    var q = item.querySelector('.faq-q');
    var a = item.querySelector('.faq-a');
    if (!q || !a) return;
    q.addEventListener('click', function () {
      var isOpen = item.classList.contains('open');
      // close siblings for a clean single-open accordion
      document.querySelectorAll('.faq-item.open').forEach(function (o) {
        if (o !== item) { o.classList.remove('open'); o.querySelector('.faq-a').style.maxHeight = null; }
      });
      if (isOpen) {
        item.classList.remove('open');
        a.style.maxHeight = null;
      } else {
        item.classList.add('open');
        a.style.maxHeight = a.scrollHeight + 'px';
      }
    });
  });

  /* ---- Contact form (front-end only; wire to your provider/Wix) ---- */
  var form = document.querySelector('.contact-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var note = form.querySelector('.form-note');
      if (note) { note.style.display = 'block'; note.textContent = 'Thank you — we’ll be in touch shortly.'; }
      form.reset();
    });
  }
})();
