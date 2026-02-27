/**
 * SEO Utilities for Spendify
 * Funções para otimizar SEO dinamicamente
 */

/**
 * Atualizar títulos de páginas dinamicamente
 * @param {string} title - Novo título
 * @param {string} description - Nova descrição
 */
function updatePageMeta(title, description) {
  document.title = title;
  
  let metaDescription = document.querySelector('meta[name="description"]');
  if (!metaDescription) {
    metaDescription = document.createElement('meta');
    metaDescription.setAttribute('name', 'description');
    document.head.appendChild(metaDescription);
  }
  metaDescription.setAttribute('content', description);
  
  // Atualizar Open Graph tags
  updateOpenGraphMeta('og:title', title);
  updateOpenGraphMeta('og:description', description);
}

/**
 * Atualizar meta tags Open Graph
 */
function updateOpenGraphMeta(property, content) {
  let meta = document.querySelector(`meta[property="${property}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('property', property);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
}

/**
 * Implementar lazy loading para imagens
 * Usar: <img data-src="image.jpg" alt="..." loading="lazy">
 */
function initLazyLoading() {
  if ('IntersectionObserver' in window) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            img.removeAttribute('data-src');
            imageObserver.unobserve(img);
          }
        }
      });
    });

    document.querySelectorAll('img[data-src]').forEach(img => {
      imageObserver.observe(img);
    });
  }
}

/**
 * Adicionar breadcrumbs ao DOM (Schema.org)
 * @param {Array} breadcrumbs - [{ name: "Home", url: "/" }, ...]
 */
function addBreadcrumbs(breadcrumbs) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": breadcrumbs.map((crumb, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": crumb.name,
      "item": `https://spendifyio.netlify.app${crumb.url}`
    }))
  };

  const scriptTag = document.createElement('script');
  scriptTag.type = 'application/ld+json';
  scriptTag.textContent = JSON.stringify(schema);
  document.head.appendChild(scriptTag);
}

/**
 * Adicionar FAQ Schema (se disponível)
 * @param {Array} faqs - [{ question: "...", answer: "..." }, ...]
 */
function addFAQSchema(faqs) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqs.map(faq => ({
      "@type": "Question",
      "name": faq.question,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.answer
      }
    }))
  };

  const scriptTag = document.createElement('script');
  scriptTag.type = 'application/ld+json';
  scriptTag.textContent = JSON.stringify(schema);
  document.head.appendChild(scriptTag);
}

/**
 * Adicionar Review/Rating Schema
 * @param {Object} rating - { ratingValue, ratingCount, bestRating, worstRating }
 */
function addRatingSchema(rating) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "AggregateRating",
    "ratingValue": rating.ratingValue,
    "ratingCount": rating.ratingCount,
    "bestRating": rating.bestRating || 5,
    "worstRating": rating.worstRating || 1
  };

  const scriptTag = document.createElement('script');
  scriptTag.type = 'application/ld+json';
  scriptTag.textContent = JSON.stringify(schema);
  document.head.appendChild(scriptTag);
}

/**
 * Registrar visualização de página no Analytics
 * @param {string} pageName - Nome da página
 * @param {string} path - Caminho/URL
 */
function trackPageView(pageName, path) {
  if (typeof gtag !== 'undefined') {
    gtag('config', 'GA_MEASUREMENT_ID', {
      'page_path': path,
      'page_title': pageName
    });
  }
  
  // Fallback para Google Analytics antigo
  if (typeof ga !== 'undefined') {
    ga('send', 'pageview', path);
  }
}

/**
 * Rastrear eventos de conversão
 * @param {string} eventName - Nome do evento (ex: "signup", "plan_upgrade")
 * @param {Object} eventData - Dados do evento
 */
function trackConversion(eventName, eventData = {}) {
  if (typeof gtag !== 'undefined') {
    gtag('event', eventName, eventData);
  }
}

/**
 * Implementar scroll tracking para engajamento
 */
function initScrollTracking() {
  let scrollPercentage = 0;
  
  window.addEventListener('scroll', () => {
    const documentHeight = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = window.scrollY / documentHeight;
    scrollPercentage = Math.round(scrolled * 100);
    
    // Rastrear marcos importantes
    if (scrollPercentage === 25 || scrollPercentage === 50 || scrollPercentage === 75 || scrollPercentage === 100) {
      trackConversion('scroll_depth', { value: scrollPercentage });
    }
  });
}

/**
 * Implementar time-on-page tracking
 */
function initTimeTracking() {
  const startTime = Date.now();
  
  window.addEventListener('beforeunload', () => {
    const timeOnPage = Date.now() - startTime;
    trackConversion('time_on_page', { value: timeOnPage / 1000 }); // em segundos
  });
}

/**
 * Verificar Core Web Vitals
 * Requer: npm install web-vitals
 */
async function trackCoreWebVitals() {
  try {
    const { getCLS, getFID, getLCP, getFCP, getTTFB } = await import('https://unpkg.com/web-vitals?module');
    
    getCLS(metric => {
      console.log('CLS:', metric.value);
      // Enviar para backend se necessário
    });
    
    getFID(metric => {
      console.log('FID:', metric.value);
    });
    
    getLCP(metric => {
      console.log('LCP:', metric.value);
    });
    
    getFCP(metric => {
      console.log('FCP:', metric.value);
    });
    
    getTTFB(metric => {
      console.log('TTFB:', metric.value);
    });
  } catch (error) {
    console.warn('Web Vitals library not available:', error);
  }
}

/**
 * Adicionar Links Internos Dinamicamente
 * Útil para navegação e SEO
 */
function addInternalLinks() {
  const links = [
    { href: '#features', text: 'Principais Recursos', title: 'Ver os principais recursos do Spendify' },
    { href: '#pricing', text: 'Planos de Preço', title: 'Ver e comparar nossos planos' }
  ];
  
  const nav = document.querySelector('nav');
  if (nav) {
    const ul = nav.querySelector('ul') || document.createElement('ul');
    links.forEach(link => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.text;
      a.title = link.title;
      a.rel = 'internal';
      li.appendChild(a);
      ul.appendChild(li);
    });
  }
}

/**
 * Validar e melhorar alt text em imagens
 */
function validateImageAltText() {
  const images = document.querySelectorAll('img');
  const missingAlt = [];
  
  images.forEach((img, index) => {
    if (!img.alt || img.alt.trim() === '') {
      missingAlt.push({
        src: img.src,
        index: index,
        suggestion: img.src.split('/').pop().replace(/\.[^/.]+$/, '')
      });
    }
  });
  
  if (missingAlt.length > 0) {
    console.warn('❌ Imagens com alt text faltando:', missingAlt);
  } else {
    console.log('✅ Todas as imagens possuem alt text');
  }
  
  return missingAlt;
}

/**
 * Gerar dinâmico sitemap em JSON
 * Pode ser consumido pelo backend para gerar XML
 */
function generateSitemapJSON() {
  const sitemap = {
    version: '1.0',
    lastUpdate: new Date().toISOString(),
    urls: [
      {
        loc: 'https://spendifyio.netlify.app',
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'weekly',
        priority: '1.0'
      },
      {
        loc: 'https://spendifyio.netlify.app#features',
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'monthly',
        priority: '0.8'
      },
      {
        loc: 'https://spendifyio.netlify.app#pricing',
        lastmod: new Date().toISOString().split('T')[0],
        changefreq: 'monthly',
        priority: '0.8'
      }
    ]
  };
  
  return sitemap;
}

/**
 * Inicializar todas as otimizações de SEO
 */
function initSEOOptimizations() {
  // Execute na página carregada
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAllSEO();
    });
  } else {
    initAllSEO();
  }
}

function initAllSEO() {
  console.log('🚀 Iniciando otimizações de SEO...');
  
  // Lazy loading de imagens
  initLazyLoading();
  
  // Validar alt text
  validateImageAltText();
  
  // Scroll tracking
  initScrollTracking();
  
  // Time tracking
  initTimeTracking();
  
  // Core Web Vitals (se disponível)
  // trackCoreWebVitals();
  
  console.log('✅ Otimizações de SEO ativadas!');
}

// Exportar funções para uso
window.SpendifySEO = {
  updatePageMeta,
  initLazyLoading,
  addBreadcrumbs,
  addFAQSchema,
  addRatingSchema,
  trackPageView,
  trackConversion,
  validateImageAltText,
  generateSitemapJSON,
  initSEOOptimizations
};

// Iniciar automaticamente
initSEOOptimizations();
