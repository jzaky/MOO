/* =============================================================
   Heartland Mutual — front-end behavior (vanilla JS, no deps)
   Everything runs in the browser; nothing is sent anywhere.

   Sections:
     1.  Data (products, testimonials, FAQs, mock agents)
     2.  Rendering helpers (build cards / slides / accordion)
     3.  Header: scroll shadow, mega-menu, mobile menu
     4.  Quote form: multi-step nav + validation + estimate
     5.  Agent finder
     6.  Testimonial carousel
     7.  FAQ accordion
     8.  Misc (footer year)
   ============================================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------------------------------------------------
     1. DATA
     --------------------------------------------------------- */
  const products = [
    { icon: '🛡️', name: 'Term Life', blurb: 'Affordable coverage for a set number of years — great while kids are home or a mortgage is being paid off.', price: '12', unit: '/mo' },
    { icon: '🌳', name: 'Whole Life', blurb: 'Lifelong protection that builds cash value you can borrow against later.', price: '48', unit: '/mo' },
    { icon: '🩺', name: 'Medicare Supplement', blurb: 'Helps cover the gaps Original Medicare leaves behind, like copays and deductibles.', price: '95', unit: '/mo' },
    { icon: '💼', name: 'Disability Income', blurb: 'Replaces part of your paycheck if an illness or injury keeps you from working.', price: '29', unit: '/mo' }
  ];

  const testimonials = [
    { quote: 'Signing up took ten minutes and an actual person called me back the same day. Easiest insurance decision I\'ve made.', name: 'Jordan P., demo member', stars: 5 },
    { quote: 'I finally understand what I\'m paying for. The quote tool spelled everything out with no jargon.', name: 'Sam R., demo member', stars: 5 },
    { quote: 'Switched my Medicare supplement over and saved enough to cover my gym membership. No pressure the whole way.', name: 'Alex M., demo member', stars: 4 }
  ];

  const faqs = [
    { q: 'Is Heartland Mutual a real company?', a: 'No. It is a fictional brand built as a front-end learning project. No products are sold and no data is collected.' },
    { q: 'Do I need a medical exam?', a: 'In this demo, many "applications" return an instant decision with no exam. Real insurers vary — always read the actual policy.' },
    { q: 'How is my quote calculated?', a: 'A small formula in your browser multiplies a base rate by your age, coverage amount, and a few risk factors. It is illustrative only.' },
    { q: 'What happens to the info I type?', a: 'Nothing leaves your browser. There is no server, no database, and no tracking in this project.' },
    { q: 'Can I use this code myself?', a: 'Yes — it was written to be read and reused. See the README in the repository for a walkthrough of how each piece works.' }
  ];

  // A tiny lookup so the ZIP search feels real without a backend.
  const agentsByRegion = {
    north: [
      { name: 'Dana Whitfield', title: 'Senior Life Specialist', phone: '(555) 010-2048' },
      { name: 'Marcus Lee', title: 'Medicare Advisor', phone: '(555) 010-7781' }
    ],
    south: [
      { name: 'Priya Nandakumar', title: 'Family Coverage Agent', phone: '(555) 010-3390' },
      { name: 'Theo Garrett', title: 'Disability & Income', phone: '(555) 010-6624' }
    ],
    central: [
      { name: 'Rosa Delgado', title: 'Retirement Planner', phone: '(555) 010-1157' },
      { name: 'Owen Fletcher', title: 'Whole Life Specialist', phone: '(555) 010-9043' }
    ]
  };

  /* ---------------------------------------------------------
     2. RENDERING
     --------------------------------------------------------- */

  // Product cards
  const productGrid = document.getElementById('productGrid');
  productGrid.innerHTML = products.map(p => `
    <article class="card">
      <div class="card-icon" aria-hidden="true">${p.icon}</div>
      <h3>${p.name}</h3>
      <p>${p.blurb}</p>
      <p class="card-price">from $${p.price}<span>${p.unit}</span></p>
      <a href="#quote" class="btn btn-small">Get a quote</a>
    </article>
  `).join('');

  // Testimonial slides
  const track = document.getElementById('carouselTrack');
  track.innerHTML = testimonials.map(t => `
    <div class="slide">
      <div class="stars" aria-label="${t.stars} out of 5 stars">${'★'.repeat(t.stars)}${'☆'.repeat(5 - t.stars)}</div>
      <blockquote>“${t.quote}”</blockquote>
      <cite>— ${t.name}</cite>
    </div>
  `).join('');

  // FAQ accordion items
  const accordion = document.getElementById('accordion');
  accordion.innerHTML = faqs.map((f, i) => `
    <div class="accordion-item">
      <button class="accordion-trigger" aria-expanded="false" aria-controls="panel-${i}" id="trigger-${i}">
        <span>${f.q}</span><span class="plus" aria-hidden="true">+</span>
      </button>
      <div class="accordion-panel" id="panel-${i}" role="region" aria-labelledby="trigger-${i}">
        <p>${f.a}</p>
      </div>
    </div>
  `).join('');

  /* ---------------------------------------------------------
     3. HEADER
     --------------------------------------------------------- */
  const header = document.getElementById('siteHeader');
  window.addEventListener('scroll', () => {
    header.classList.toggle('scrolled', window.scrollY > 10);
  }, { passive: true });

  // Mega-menu (click to toggle; closes on outside click / Escape)
  const megaItem = document.querySelector('.has-mega');
  const megaBtn = megaItem?.querySelector('.nav-link');
  if (megaBtn) {
    megaBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = megaItem.classList.toggle('open');
      megaBtn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', () => {
      megaItem.classList.remove('open');
      megaBtn.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        megaItem.classList.remove('open');
        megaBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Mobile menu
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobileMenu');
  hamburger.addEventListener('click', () => {
    const open = mobileMenu.hasAttribute('hidden');
    if (open) { mobileMenu.removeAttribute('hidden'); }
    else { mobileMenu.setAttribute('hidden', ''); }
    hamburger.setAttribute('aria-expanded', String(open));
  });
  // Close mobile menu when a link is tapped
  mobileMenu.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => {
      mobileMenu.setAttribute('hidden', '');
      hamburger.setAttribute('aria-expanded', 'false');
    })
  );

  /* ---------------------------------------------------------
     4. QUOTE FORM — multi-step, validation, estimate
     --------------------------------------------------------- */
  const form = document.getElementById('quoteForm');
  const stepFields = [...form.querySelectorAll('.step')];
  const indicators = [...document.querySelectorAll('#stepIndicator li')];
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const submitBtn = document.getElementById('submitBtn');
  let current = 1;
  const totalSteps = stepFields.length;

  // Live coverage slider label
  const coverage = document.getElementById('coverage');
  const coverageOut = document.getElementById('coverageOut');
  const money = n => '$' + Number(n).toLocaleString('en-US');
  coverage.addEventListener('input', () => { coverageOut.textContent = money(coverage.value); });

  function showStep(n) {
    stepFields.forEach(fs => fs.toggleAttribute('hidden', Number(fs.dataset.step) !== n));
    indicators.forEach(li => {
      const s = Number(li.dataset.step);
      li.classList.toggle('active', s === n);
      li.classList.toggle('done', s < n);
    });
    prevBtn.toggleAttribute('hidden', n === 1);
    nextBtn.toggleAttribute('hidden', n === totalSteps);
    submitBtn.toggleAttribute('hidden', n !== totalSteps);
  }

  // Validate only the inputs in the current step.
  function validateStep(n) {
    const fs = stepFields.find(f => Number(f.dataset.step) === n);
    const controls = [...fs.querySelectorAll('input, select')];
    // group radios by name so we validate each group once
    const seenRadioGroups = new Set();
    let ok = true;

    for (const el of controls) {
      const errEl = fs.querySelector(`.error[data-for="${el.name}"]`);
      let message = '';

      if (el.type === 'radio') {
        if (seenRadioGroups.has(el.name)) continue;
        seenRadioGroups.add(el.name);
        const checked = form.querySelector(`input[name="${el.name}"]:checked`);
        if (!checked) message = 'Please choose an option.';
      } else if (el.hasAttribute('required') && !el.value.trim()) {
        message = 'This field is required.';
      } else if (el.type === 'email' && el.value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(el.value)) {
        message = 'Enter a valid email address.';
      } else if (el.id === 'age' && el.value && (el.value < 18 || el.value > 85)) {
        message = 'Age must be between 18 and 85.';
      } else if (el.id === 'zip' && el.value && !/^\d{5}$/.test(el.value)) {
        message = 'Enter a 5-digit ZIP code.';
      }

      if (message) {
        ok = false;
        el.setAttribute('aria-invalid', 'true');
        if (errEl) errEl.textContent = message;
      } else {
        el.removeAttribute('aria-invalid');
        if (errEl) errEl.textContent = '';
      }
    }
    return ok;
  }

  nextBtn.addEventListener('click', () => {
    if (!validateStep(current)) return;
    current = Math.min(current + 1, totalSteps);
    showStep(current);
  });
  prevBtn.addEventListener('click', () => {
    current = Math.max(current - 1, 1);
    showStep(current);
  });

  // A deliberately simple, transparent premium formula.
  function estimatePremium(data) {
    const base = { term: 10, whole: 40, medsupp: 90, disability: 25 }[data.product] || 20;
    const ageFactor = 1 + Math.max(0, (data.age - 30)) * 0.03;   // older ≈ pricier
    const coverageFactor = data.coverage / 250000;                // scaled to $250k
    const tobaccoFactor = data.tobacco === 'yes' ? 1.6 : 1;
    const monthly = base * ageFactor * coverageFactor * tobaccoFactor;
    return Math.max(8, Math.round(monthly));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateStep(current)) return;

    const fd = new FormData(form);
    const data = {
      age: Number(fd.get('age')),
      product: fd.get('product'),
      coverage: Number(fd.get('coverage')),
      tobacco: fd.get('tobacco')
    };
    const amount = estimatePremium(data);

    const estimate = document.getElementById('estimate');
    document.getElementById('estimateAmount').textContent = money(amount) + '/mo';
    estimate.removeAttribute('hidden');
    estimate.scrollIntoView({ behavior: 'smooth', block: 'center' });
    submitBtn.textContent = 'Recalculate';
  });

  showStep(1); // initialize

  /* ---------------------------------------------------------
     5. AGENT FINDER
     --------------------------------------------------------- */
  const agentSearch = document.getElementById('agentSearch');
  const agentResults = document.getElementById('agentResults');
  const agentZip = document.getElementById('agentZip');

  // Map a ZIP to one of three pretend regions by its first digit.
  function regionForZip(zip) {
    const first = Number(zip[0]);
    if (first <= 3) return 'north';
    if (first <= 6) return 'central';
    return 'south';
  }

  agentSearch.addEventListener('submit', (e) => {
    e.preventDefault();
    const zip = agentZip.value.trim();
    if (!/^\d{5}$/.test(zip)) {
      agentResults.innerHTML = '<p class="agent-empty">Please enter a valid 5-digit ZIP code.</p>';
      return;
    }
    const list = agentsByRegion[regionForZip(zip)];
    agentResults.innerHTML = list.map(a => {
      const initials = a.name.split(' ').map(w => w[0]).join('');
      return `
        <div class="agent-card">
          <div class="agent-avatar" aria-hidden="true">${initials}</div>
          <div>
            <h4>${a.name}</h4>
            <p>${a.title}</p>
            <p>${a.phone}</p>
          </div>
        </div>`;
    }).join('');
  });

  /* ---------------------------------------------------------
     6. CAROUSEL
     --------------------------------------------------------- */
  const dotsWrap = document.getElementById('carouselDots');
  const slides = [...track.children];
  let slide = 0;

  // Build one dot per slide
  dotsWrap.innerHTML = slides.map((_, i) =>
    `<button role="tab" aria-label="Go to story ${i + 1}" data-i="${i}"></button>`
  ).join('');
  const dots = [...dotsWrap.children];

  function goTo(i) {
    slide = (i + slides.length) % slides.length;
    track.style.transform = `translateX(-${slide * 100}%)`;
    dots.forEach((d, di) => d.classList.toggle('active', di === slide));
  }
  document.getElementById('carouselPrev').addEventListener('click', () => goTo(slide - 1));
  document.getElementById('carouselNext').addEventListener('click', () => goTo(slide + 1));
  dots.forEach(d => d.addEventListener('click', () => goTo(Number(d.dataset.i))));

  // Auto-advance, pausing on hover
  let timer = setInterval(() => goTo(slide + 1), 6000);
  const carousel = document.getElementById('carousel');
  carousel.addEventListener('mouseenter', () => clearInterval(timer));
  carousel.addEventListener('mouseleave', () => { timer = setInterval(() => goTo(slide + 1), 6000); });
  goTo(0);

  /* ---------------------------------------------------------
     7. ACCORDION
     --------------------------------------------------------- */
  accordion.addEventListener('click', (e) => {
    const trigger = e.target.closest('.accordion-trigger');
    if (!trigger) return;
    const panel = document.getElementById(trigger.getAttribute('aria-controls'));
    const open = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!open));
    panel.style.maxHeight = open ? null : panel.scrollHeight + 'px';
  });

  /* ---------------------------------------------------------
     8. MISC
     --------------------------------------------------------- */
  document.getElementById('year').textContent = new Date().getFullYear();
});
