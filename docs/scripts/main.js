/**
 * Lógica global del sitio (Marius Bulat Simon)
 * --------------------------------------------------------------------------
 * 1. Garantiza el título fijo de la pestaña ("Marius Bulat Simon").
 * 2. Abre enlaces externos en pestaña nueva de forma segura.
 * 3. Gestiona el enrutamiento bilingüe (EN en raíz `/` y ES en `/es/`)
 *    y la animación del selector de idioma.
 * 4. Controla el desplegable "Show more / Ver más" de las tarjetas de Portfolio.
 */
(function () {
  "use strict";

  const SITE_TITLE = "Marius Bulat Simon";
  const ASSET_EXT_REGEX = /\.(pdf|png|jpe?g|svg|gif|webp|zip|csv|xlsx?)$/i;

  // Asegura el título fijo desde la carga inicial
  document.title = SITE_TITLE;

  function initSite() {
    document.title = SITE_TITLE;

    const path = window.location.pathname;
    const esMatch = path.match(/^(.*)\/es(\/.*|$)/);
    const isSpanish = Boolean(esMatch);

    // Raíz dinámica del sitio: funciona tanto en dominio raíz (marbul33.github.io/)
    // como en subrutas o servidores locales de previsualización.
    const brand = document.querySelector(".navbar-brand");
    const brandHref = brand ? brand.getAttribute("href") : null;
    const siteRoot = isSpanish
      ? esMatch[1] + "/"
      : brandHref && !brandHref.startsWith("#")
        ? new URL(brandHref, window.location.href).pathname.replace(/index\.html$/, "")
        : "/";

    /**
     * Convierte un enlace interno en inglés a su equivalente bajo `/es/`.
     * Ignora anclas, esquemas especiales, dominios externos y archivos estáticos
     * (p. ej. los PDFs del CV alojados únicamente en `/cv/`).
     */
    function toSpanishUrl(rawHref) {
      if (
        !rawHref ||
        rawHref.startsWith("#") ||
        rawHref.startsWith("mailto:") ||
        rawHref.startsWith("javascript:")
      ) {
        return null;
      }

      const url = new URL(rawHref, window.location.href);
      if (url.origin !== window.location.origin) return null;
      if (ASSET_EXT_REGEX.test(url.pathname)) return null;
      if (/\/es(\/|$)/.test(url.pathname)) return null;

      if (url.pathname.startsWith(siteRoot)) {
        const rel = url.pathname.slice(siteRoot.length);
        return siteRoot + "es/" + rel + url.search + url.hash;
      }
      return null;
    }

    // 1. Enlaces externos en pestaña nueva + etiqueta accesible en botones GitHub
    document.querySelectorAll('a[href^="http"]').forEach(function (link) {
      if (link.hostname !== window.location.hostname) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener noreferrer");
      }
      if (link.classList.contains("portfolio-gh-link") && !link.hasAttribute("aria-label")) {
        link.setAttribute("aria-label", isSpanish ? "Repositorio en GitHub" : "GitHub repository");
      }
    });

    // 2. Selector de idioma (bandera actual + ruta espejo + animación de cortinilla)
    const switcher = document.querySelector(".lang-switcher");
    if (switcher) {
      const link = switcher.closest("a");
      if (link) {
        if (isSpanish) {
          switcher.classList.add("is-es");
          switcher.setAttribute("title", "Switch to English");
          const subPath = (esMatch[2] || "/").replace(/^\//, "");
          let enPath = siteRoot + subPath;
          if (enPath.endsWith("/")) enPath += "index.html";
          link.href = enPath;
        } else {
          switcher.setAttribute("title", "Cambiar a Español");
          let relPath = path.startsWith(siteRoot)
            ? path.slice(siteRoot.length)
            : path.replace(/^\//, "");
          if (!relPath || relPath.endsWith("/")) relPath += "index.html";
          link.href = siteRoot + "es/" + relPath;
        }

        link.addEventListener("click", function (e) {
          // Respeta clic central o con teclas modificadoras (abrir en pestaña nueva)
          if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          switcher.classList.add("is-switching");
          setTimeout(function () {
            window.location.href = link.href;
          }, 280);
        });

        // Restaura el estado visual si el navegador recupera la página desde caché (bfcache)
        window.addEventListener("pageshow", function () {
          switcher.classList.remove("is-switching");
        });
      }
    }

    // 3. Reescritura de navegación hacia `/es/` cuando el usuario navega en español
    if (isSpanish) {
      if (brand && brandHref) {
        const brandEs = toSpanishUrl(brandHref);
        if (brandEs) brand.href = brandEs;
      }

      document
        .querySelectorAll(".navbar-nav .nav-link, .navbar-nav .dropdown-item")
        .forEach(function (navLink) {
          if (navLink.querySelector(".lang-switcher")) return;
          const esHref = toSpanishUrl(navLink.getAttribute("href"));
          if (esHref) navLink.href = esHref;
        });

      document.querySelectorAll("main a[href]").forEach(function (contentLink) {
        const esHref = toSpanishUrl(contentLink.getAttribute("href"));
        if (esHref) contentLink.href = esHref;
      });
    }

    // 4. Botón desplegable "Show more / Ver más" en las tarjetas del Portfolio
    const portfolioCards = document.querySelectorAll(".portfolio-card");
    if (portfolioCards.length > 0) {
      const htmlMore = (isSpanish ? "Ver más" : "Show more") + ' <i class="bi bi-chevron-down"></i>';
      const htmlLess = (isSpanish ? "Ver menos" : "Show less") + ' <i class="bi bi-chevron-up"></i>';
      let activeCard = null;

      function setCardExpanded(card, expand) {
        const btn = card.querySelector(".portfolio-toggle-btn");
        card.classList.toggle("is-expanded", expand);
        if (btn) {
          btn.setAttribute("aria-expanded", String(expand));
          btn.innerHTML = expand ? htmlLess : htmlMore;
        }
        if (expand) {
          activeCard = card;
        } else if (activeCard === card) {
          activeCard = null;
        }
      }

      portfolioCards.forEach(function (card) {
        const body = card.querySelector(".portfolio-body");
        if (!body) return;

        // Solo inserta el botón si el primer párrafo supera 3 líneas o existen bloques extra
        const firstP = body.querySelector("p");
        const isClamped = firstP ? firstP.scrollHeight > firstP.clientHeight + 1 : false;
        const hasExtraBlocks =
          body.querySelector(":scope > p:not(:first-of-type), :scope > ul, :scope > ol") !== null;

        if (!isClamped && !hasExtraBlocks) return;

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "portfolio-toggle-btn";
        btn.setAttribute("aria-expanded", "false");
        btn.innerHTML = htmlMore;

        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          const willExpand = !card.classList.contains("is-expanded");
          if (activeCard && activeCard !== card) {
            setCardExpanded(activeCard, false);
          }
          setCardExpanded(card, willExpand);
        });

        body.appendChild(btn);
      });

      // Cierra la tarjeta activa al hacer clic fuera o al pulsar Escape
      document.addEventListener("click", function (e) {
        if (activeCard && !activeCard.contains(e.target)) {
          setCardExpanded(activeCard, false);
        }
      });

      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && activeCard) {
          setCardExpanded(activeCard, false);
        }
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSite);
  } else {
    initSite();
  }
})();
