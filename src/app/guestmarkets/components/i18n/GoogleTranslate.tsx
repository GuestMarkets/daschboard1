'use client';

import { useEffect } from 'react';

declare global {
  interface GoogleTranslateAPI {
    translate: {
      TranslateElement: {
        // Le constructeur attendu par l'API Google
        new (
          options: {
            pageLanguage: string;
            includedLanguages?: string;
            autoDisplay?: boolean;
            layout?: number; // InlineLayout renvoie un nombre
          },
          containerId: string
        ): unknown;
        // InlineLayout expose des constantes numériques (ex: SIMPLE)
        InlineLayout: {
          SIMPLE: number;
        };
      };
    };
  }

  interface Window {
    googleTranslateElementInit?: () => void;
    google?: GoogleTranslateAPI;
  }
}

export default function GoogleTranslate() {
  useEffect(() => {
    // 1) CSS de secours (au cas où le CSS global charge plus tard)
    const style = document.createElement('style');
    style.innerHTML = `
      #goog-gt-tt,.goog-te-banner-frame,.goog-te-balloon-frame{display:none!important}
      iframe.goog-te-banner-frame{display:none!important}
      html.translated-ltr body,html.translated-rtl body,html body{top:0!important}
    `;
    document.head.appendChild(style);

    // 2) Nettoyage proactif de la bannière & du top via MutationObserver
    const killBar = () => {
      const banner = document.querySelector('.goog-te-banner-frame');
      if (banner && banner.parentElement) banner.parentElement.removeChild(banner);
      document.documentElement.style.top = '0px';
      document.body.style.top = '0px';
    };

    const mo = new MutationObserver(() => killBar());
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // 3) Initialisation Google avec autoDisplay:false (empêche la barre)
    window.googleTranslateElementInit = function () {
      try {
        if (window.google?.translate?.TranslateElement) {
          const { TranslateElement } = window.google.translate;
          new TranslateElement(
            {
              pageLanguage: 'fr',
              // includedLanguages: 'fr,en,es,de,it,pt,ar,ru,zh-CN,ja',
              autoDisplay: false,
              layout: TranslateElement.InlineLayout.SIMPLE,
            },
            'google_translate_element'
          );
        }
      } catch {
        // no-op
      }
      // sécurité
      killBar();
      setTimeout(killBar, 100);
      setTimeout(killBar, 500);
      setTimeout(killBar, 1500);
    };

    // 4) Charge le script si absent
    const alreadyLoaded = document.querySelector<HTMLScriptElement>(
      'script[src*="translate.google.com/translate_a/element.js"]'
    );
    if (!alreadyLoaded) {
      const s = document.createElement('script');
      s.src = '//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
      s.async = true;
      document.head.appendChild(s);
    } else {
      // si déjà présent, on relance l’init si possible
      if (window.google?.translate?.TranslateElement) {
        window.googleTranslateElementInit?.();
      }
    }

    // 5) Dernière sécurité au focus/resize
    const tidy = () => killBar();
    window.addEventListener('resize', tidy);
    window.addEventListener('focus', tidy);

    return () => {
      window.removeEventListener('resize', tidy);
      window.removeEventListener('focus', tidy);
      mo.disconnect();
      style.remove();
    };
  }, []);

  // Rien à afficher (le footer gère ton sélecteur)
  return <div id="google_translate_element" aria-hidden="true" />;
}
