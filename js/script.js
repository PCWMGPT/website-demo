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
