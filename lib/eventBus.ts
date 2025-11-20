// lib/eventBus.ts
import { EventEmitter } from "events";

// ✅ Déclare une interface globale propre pour éviter l'utilisation de `any`
declare global {
  // On ajoute une propriété optionnelle au globalThis pour stocker le bus
  // afin d'éviter la recréation en mode développement (HMR)
  // eslint-disable-next-line no-var
  var __USERS_BUS__: EventEmitter | undefined;
}

// ✅ Utilisation typée de la propriété globale
const _bus: EventEmitter | undefined = globalThis.__USERS_BUS__;

// ✅ Création (ou récupération) d'une instance unique du bus d'événements
export const usersBus: EventEmitter =
  _bus ??
  (() => {
    const b = new EventEmitter();
    globalThis.__USERS_BUS__ = b;
    return b;
  })();
