const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const axios = require("axios");

// 🔗 URL de tu Apps Script
const GOOGLE_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxka1ACmtqNnOcGPNjE3o6N4JRxfd9XcadfafmoAWdMbKiZvF8sruB5ASEZd6pi8-cYUA/exec";

// ✅ Enviar datos a Google Sheets
async function enviarAGoogleSheet({ nombre, piso, motivo, fecha, telefono }) {
  try {
    const res = await axios.post(GOOGLE_SCRIPT_URL, {
      nombre,
      piso,
      motivo,
      fecha,
      telefono,
    });

    if (res.data && res.data.success) {
      console.log("✅ Registro confirmado en Google Sheets");
    } else {
      console.warn("⚠️ Google Script respondió, pero sin 'success: true'");
    }
  } catch (error) {
    console.error("❌ Error al enviar a Google Sheets:", error.message);
  }
}

const chats = {};

const motivos = {
  1: "Jornada Laboral",
  2: "Entrega de Correspondencia",
  3: "Visita Técnica",
  4: "Reunión",
  5: "Mantenimiento",
  6: "Entrevista y/o Capacitación",
  7: "Trámite Académico",
  8: "Otro",
};

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid;
    const text = (
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      ""
    ).trim();

    // 🧠 Normalizar texto
    const textoNormalizado = text.toLowerCase();

    if (!chats[sender]) {
      if (textoNormalizado === "hola" || textoNormalizado === "registro") {
        chats[sender] = {
          paso: 1,
          nombre: "",
          piso: "",
          motivo: "",
          otro: "",
        };
        await sock.sendMessage(sender, {
          text: "Hola. ¿Cuál es tu nombre completo?",
        });
      } else {
        await sock.sendMessage(sender, {
          text: "✋ Para comenzar el registro, escribe *Hola* o *Registro*.",
        });
      }
      return;
    }

    // 🔁 Continuación del flujo
    const chat = chats[sender];

    switch (chat.paso) {
      case 1:
        if (text.length < 3) {
          await sock.sendMessage(sender, {
            text: "❌ Por favor, escribe un nombre válido (mínimo 3 caracteres).",
          });
          return;
        }
        chat.nombre = text;
        chat.paso = 2;
        await sock.sendMessage(sender, {
          text: "¿A qué piso te diriges?\nResponde con el número:\n1. Piso 1\n2. Piso 2\n3. Piso 3\n4. Piso 4\n5. Piso 5\n6. Piso 6",
        });
        break;

      case 2:
        if (!["1", "2", "3", "4", "5", "6"].includes(text)) {
          await sock.sendMessage(sender, {
            text: "❌ Respuesta inválida. Por favor, responde con un número del 1 al 6 para indicar el piso.",
          });
          return;
        }
        chat.piso = `Piso ${text}`;
        chat.paso = 3;
        await sock.sendMessage(sender, {
          text:
            "¿Cuál es el motivo de tu visita? Responde con un número:\n" +
            "1. Jornada Laboral\n2. Entrega de Correspondencia\n3. Visita Técnica\n4. Reunión\n5. Mantenimiento\n6. Entrevista y/o Capacitación\n7. Trámite Académico\n8. Otro",
        });
        break;

      case 3:
        if (!Object.keys(motivos).includes(text)) {
          await sock.sendMessage(sender, {
            text: "❌ Opción inválida. Responde con un número del 1 al 8 para indicar el motivo.",
          });
          return;
        }
        chat.motivo = motivos[text];
        if (text === "8") {
          chat.paso = 4;
          await sock.sendMessage(sender, {
            text: "Escribe la razón específica de tu visita:",
          });
        } else {
          chat.paso = 5;
        }
        break;

      case 4:
        if (!text || text.length < 3) {
          await sock.sendMessage(sender, {
            text: "❌ Por favor, escribe una razón válida para tu visita (mínimo 3 caracteres).",
          });
          return;
        }
        chat.otro = text;
        chat.paso = 5;
        break;
    }

    // 📦 Paso final
    if (chat.paso === 5) {
      const fecha = new Date().toLocaleString("es-MX", {
        timeZone: "America/Mexico_City",
      });

      const motivoFinal =
        chat.motivo === "Otro" ? `Otro: ${chat.otro}` : chat.motivo;

      const resumen =
        `✅ Registro completado:\n` +
        `📛 Nombre: ${chat.nombre}\n` +
        `🏢 Piso: ${chat.piso}\n` +
        `📌 Motivo: ${motivoFinal}\n` +
        `🕒 Fecha y hora: ${fecha}`;

      await sock.sendMessage(sender, { text: resumen });

      console.log(`✅ Registro:\n${resumen}\n`);

      // 📱 Obtener número del JID
      const numero = sender.split("@")[0];

      await enviarAGoogleSheet({
        nombre: chat.nombre,
        piso: chat.piso,
        motivo: motivoFinal,
        fecha,
        telefono: numero,
      });

      delete chats[sender];
    }
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      console.log("Conexión cerrada. Reconectando:", shouldReconnect);
      if (shouldReconnect) {
        startBot();
      }
    } else if (connection === "open") {
      console.log("✅ Bot conectado a WhatsApp");
    }
  });
}

startBot();
