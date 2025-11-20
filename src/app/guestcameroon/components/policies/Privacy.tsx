'use client';

import React from 'react';
import { Shield, FileCheck, Lock } from 'lucide-react';

/**
 * Politique de confidentialité – version "soft"
 * - Carte douce (bg-white/80 + blur)
 * - Typo compacte (text-[15px])
 * - Accents bleu/purple discrets
 * - Badge conformité RGPD + encart bonnes pratiques
 */
export default function PrivacyContent() {
  return (
    <section className="max-w-3xl mx-auto">
      {/* Carte principale */}
      <div className="rounded-3xl bg-white/80 backdrop-blur-xl shadow-sm ring-1 ring-slate-200/60 p-5 md:p-8">
        {/* En-tête */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-9 w-9 rounded-2xl bg-gradient-to-br from-blue-600 to-purple-600 text-white grid place-items-center shadow-sm">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h2 className="m-0 text-lg md:text-xl font-semibold text-slate-900">
              Politique de confidentialité
            </h2>
            <p className="m-0 text-[13px] text-slate-500">
              Version interne — Guest Markets & Guest Cameroun
            </p>
          </div>
        </div>

        {/* Badge conformité */}
        <div className="mb-5">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[12px] font-medium bg-purple-50 text-purple-700 ring-1 ring-purple-100">
            <FileCheck className="h-4 w-4" />
            Conforme RGPD (principes)
          </span>
        </div>

        {/* Contenu */}
        <div className="prose prose-slate max-w-none prose-p:leading-relaxed">
          <p className="text-[15px] text-slate-700">
            Cette politique décrit les données que nous collectons, la manière dont elles sont
            utilisées et vos droits. Nous appliquons des mesures de sécurité proportionnées aux
            risques et respectons les principes du RGPD.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">1. Données traitées</h3>
          <ul className="text-[15px] text-slate-700">
            <li>Identité : nom, prénom, email ;</li>
            <li>Connexion : horodatages, adresses IP, journaux techniques ;</li>
            <li>Usage : préférences, interactions, paramètres.</li>
          </ul>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">2. Finalités</h3>
          <p className="text-[15px] text-slate-700">
            Authentification, fourniture et sécurisation du service, assistance, amélioration
            continue, communications opérationnelles (ex. : confirmations).
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">3. Base légale</h3>
          <p className="text-[15px] text-slate-700">
            Exécution du contrat (CGU), intérêt légitime (sécurité), obligations légales et,
            le cas échéant, consentement pour certaines fonctionnalités.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">4. Conservation</h3>
          <p className="text-[15px] text-slate-700">
            Les données sont conservées pendant la durée d’utilisation du service, puis archivées
            ou supprimées conformément à la loi et à nos politiques internes.
          </p>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">5. Vos droits</h3>
          <ul className="text-[15px] text-slate-700">
            <li>Accès, rectification, effacement, limitation, opposition ;</li>
            <li>Portabilité lorsque applicable ;</li>
            <li>Réclamation auprès de l’autorité compétente.</li>
          </ul>

          <h3 className="text-base md:text-[17px] text-slate-900 font-semibold">
            6. Sécurité & sous-traitants
          </h3>
          <p className="text-[15px] text-slate-700">
            Nous mettons en œuvre des mesures techniques et organisationnelles. Des sous-traitants
            (hébergement, emailing, support) peuvent intervenir sous engagements contractuels
            conformes au RGPD.
          </p>
        </div>

        {/* Callout doux sécurité */}
        <div className="mt-6 rounded-2xl bg-slate-50 ring-1 ring-slate-200/70 p-4">
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 text-white grid place-items-center shadow-sm shrink-0">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <p className="m-0 text-[14px] text-slate-900 font-medium">Protection & contact</p>
              <p className="m-0 mt-1 text-[13px] text-slate-600">
                Pour toute question liée à la confidentialité ou l’exercice de vos droits, veuillez
                contacter le support interne. L’accès à la plateforme est strictement réservé aux
                collaborateurs autorisés.
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