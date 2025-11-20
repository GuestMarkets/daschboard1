'use client';

import React from 'react';
import { FileText, ShieldCheck, AlertTriangle } from 'lucide-react';

/**
 * CGU – version "soft" respectant la charte (accents bleu/purple, tons slate)
 * - Carte douce (bg-white/80 + backdrop blur)
 * - Typo compacte et lisible (text-[15px] ~ text-sm)
 * - Titres sobres, séparateurs légers
 * - Badges & callouts discrets
 */
export default function TermsContent() {
  return (
    <section className="max-w-3xl mx-auto">
      {/* Carte principale */}
      <div className="rounded-3xl bg-white/80 backdrop-blur-xl shadow-sm ring-1 ring-slate-200/60 p-5 md:p-8">
        {/* En-tête compact */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white grid place-items-center shadow-sm">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h2 className="m-0 text-lg md:text-xl font-semibold text-slate-900">
              Conditions Générales d’Utilisation
            </h2>
            <p className="m-0 text-[13px] text-slate-500">
              Version interne — Guest Markets & Guest Cameroun
            </p>
          </div>
        </div>

        {/* Badge d’avertissement très discret */}
        <div className="mb-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-100">
            <ShieldCheck className="h-4 w-4" />
            Accès professionnel réservé
          </span>
        </div>

        {/* Contenu (typo adoucie) */}
        <div className="prose prose-slate max-w-none prose-p:leading-relaxed prose-headings:scroll-mt-24">
          <p className="text-[15px] text-slate-700">
            Les présentes CGU encadrent l’accès et l’utilisation de la plateforme. En créant un
            compte ou en vous connectant, vous acceptez sans réserve l’ensemble des dispositions
            ci-dessous.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">1. Accès au service</h3>
          <p className="text-[15px] text-slate-700">
            Le service est proposé « tel quel ». Nous nous efforçons d’assurer une disponibilité
            élevée, sans garantir l’absence d’interruptions. Vous êtes responsable de la sécurité
            de vos identifiants et de toute activité effectuée avec votre compte.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">2. Compte utilisateur</h3>
          <ul className="text-[15px] text-slate-700">
            <li>Fournir des informations exactes et à jour ;</li>
            <li>Ne pas usurper l’identité d’un tiers ;</li>
            <li>Informer le support en cas d’accès non autorisé présumé.</li>
          </ul>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">3. Utilisation conforme</h3>
          <p className="text-[15px] text-slate-700">
            Sont interdits : tentative d’intrusion, rétro-ingénierie, contournement de sécurité,
            surcharge intentionnelle, diffusion de contenus illicites ou violant des droits tiers.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">4. Propriété & contenus</h3>
          <p className="text-[15px] text-slate-700">
            Les marques, logos et éléments graphiques demeurent la propriété de leurs titulaires.
            L’utilisateur conserve ses droits sur ses contenus, qu’il nous autorise à traiter
            exclusivement pour le bon fonctionnement du service.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">5. Suspension & résiliation</h3>
          <p className="text-[15px] text-slate-700">
            En cas de violation des CGU, nous pouvons suspendre ou résilier le compte, avec ou sans
            préavis, dans le respect de la loi applicable.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">6. Évolution des CGU</h3>
          <p className="text-[15px] text-slate-700">
            Ces CGU peuvent être mises à jour. La poursuite de l’utilisation après notification
            vaut acceptation des nouvelles conditions.
          </p>
        </div>

        {/* Callout doux (confidentialité) */}
        <div className="mt-6 rounded-2xl bg-slate-50 ring-1 ring-slate-200/70 p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 text-white grid place-items-center shadow-sm shrink-0">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div>
              <p className="m-0 text-[14px] text-slate-900 font-medium">
                Confidentialité & conformité
              </p>
              <p className="m-0 mt-1 text-[13px] text-slate-600">
                L’usage est strictement réservé aux collaborateurs autorisés. Toute activité peut
                être journalisée à des fins de sécurité et d’audit interne.
              </p>
            </div>
          </div>
        </div>

        {/* Pied discret */}
        <div className="mt-5 pt-4 border-t border-slate-200/60">
          <p className="m-0 text-[12px] text-slate-500">
            © {new Date().getFullYear()} Guest Markets & Guest Cameroun — Tous droits réservés.
          </p>
        </div>
      </div>
    </section>
  );
}
