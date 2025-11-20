export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { pool } from "../../../../../lib/db";
import { requireUser } from "../_utils";
import type { RowDataPacket, ResultSetHeader } from "mysql2";

// GET - Récupérer tous les paramètres de chat
export async function GET(req: Request) {
  try {
    const { userId, isSuper } = await requireUser();

    if (!isSuper) {
      return NextResponse.json({ error: "Accès réservé aux super administrateurs" }, { status: 403 });
    }

    try {
      const [rows] = await pool.query<RowDataPacket[]>(
        `SELECT setting_key, setting_value, description, updated_at FROM chat_settings ORDER BY setting_key`
      );

      const settings = rows.reduce((acc, row) => {
        acc[row.setting_key] = {
          value: row.setting_value === 'true' ? true : row.setting_value === 'false' ? false : row.setting_value,
          description: row.description || '',
          updatedAt: row.updated_at
        };
        return acc;
      }, {} as Record<string, any>);

      // Valeurs par défaut si la table est vide
      if (Object.keys(settings).length === 0) {
        return NextResponse.json({
          settings: {
            allow_message_deletion: {
              value: false,
              description: 'Permettre à tous les utilisateurs de supprimer leurs messages (au-delà de 15min)',
              updatedAt: null
            }
          }
        });
      }

      return NextResponse.json({ settings });
    } catch (dbError: any) {
      // Si la table n'existe pas, créer la structure par défaut
      if (dbError.code === 'ER_NO_SUCH_TABLE') {
        await initializeChatSettings();
        return NextResponse.json({
          settings: {
            allow_message_deletion: {
              value: false,
              description: 'Permettre à tous les utilisateurs de supprimer leurs messages (au-delà de 15min)',
              updatedAt: null
            }
          }
        });
      }
      throw dbError;
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

// PUT - Mettre à jour les paramètres
export async function PUT(req: Request) {
  try {
    const { userId, isSuper } = await requireUser();

    if (!isSuper) {
      return NextResponse.json({ error: "Accès réservé aux super administrateurs" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.settings) {
      return NextResponse.json({ error: "Paramètres requis" }, { status: 400 });
    }

    // Assurer que la table existe
    await initializeChatSettings();

    const allowedSettings = ['allow_message_deletion'];
    const updates = [];

    for (const [key, value] of Object.entries(body.settings)) {
      if (!allowedSettings.includes(key)) {
        return NextResponse.json({ error: `Paramètre non autorisé: ${key}` }, { status: 400 });
      }

      const settingValue = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);

      await pool.query<ResultSetHeader>(
        `INSERT INTO chat_settings (setting_key, setting_value, updated_at)
         VALUES (?, ?, NOW())
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_at = VALUES(updated_at)`,
        [key, settingValue]
      );

      updates.push(`${key}: ${settingValue}`);
    }

    return NextResponse.json({
      ok: true,
      message: `Paramètres mis à jour: ${updates.join(', ')}`,
      updatedBy: userId,
      timestamp: new Date().toISOString()
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Erreur serveur" }, { status: 500 });
  }
}

// Fonction pour initialiser la table et les paramètres par défaut
async function initializeChatSettings() {
  try {
    // Créer la table si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_settings (
        setting_key VARCHAR(100) PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Ajouter les paramètres par défaut
    await pool.query(
      `INSERT IGNORE INTO chat_settings (setting_key, setting_value, description) VALUES
       ('allow_message_deletion', 'false', 'Permettre à tous les utilisateurs de supprimer leurs messages (au-delà de 15min)')`
    );

    // Aussi créer la table des réactions si elle n'existe pas
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_message_reactions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        message_id INT NOT NULL,
        user_id INT NOT NULL,
        emoji VARCHAR(10) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_reaction (message_id, user_id, emoji),
        INDEX idx_message_reactions (message_id),
        INDEX idx_user_reactions (user_id)
      )
    `);

    // Ajouter les colonnes manquantes à chat_messages si nécessaire
    await pool.query(`
      ALTER TABLE chat_messages
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL
    `);

  } catch (e: any) {
    console.error('Erreur initialisation chat settings:', e);
    // Ne pas faire échouer si les colonnes existent déjà
  }
}
