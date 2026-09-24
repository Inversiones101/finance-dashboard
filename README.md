# Inversiones 101 — Sistema financiero

ERP financiero ligero de **Inversiones 101 LLC**: P&L, flujo de caja y aportes del propietario, con usuarios y permisos por módulo.

## Uso diario (sin tocar código)

| Quiero… | Dónde |
|---|---|
| Registrar un gasto | **Gastos → Nuevo gasto**. Elige con qué se pagó: tarjeta personal = aporte tuyo; Mercury Checking = sale de la caja; Mercury IO = queda por pagar. |
| Registrar un cobro | **Ingresos → Nuevo ingreso**. Elige el producto y dónde cayó el dinero (normalmente Skool). Si es recurrente y tiene nombre, el miembro se crea solo. |
| Alguien cancela o vuelve | **Miembros y MRR →** dar de baja / reactivar. El MRR, el ARR y el pronóstico se actualizan al instante. |
| Pasar dinero de Skool a Mercury | **Cuentas → Saldo Skool → Registrar payout**. Skool no paga gastos: solo hace payouts. |
| Algo que vi en el estado de cuenta | **Cuentas →** la cuenta **→ Movimiento**, y elige qué es (ingreso, gasto, aporte, cashback…). Los ya registrados se corrigen con el ícono de etiqueta. |
| Registrar el cobro de una suscripción | **Suscripciones →** ícono de recibo en la fila. Crea el gasto y avanza la renovación. |
| Pagar una cuota (Skool Scaling u otro contrato) | **Deudas y compromisos → Pagar cuota**. |
| Pagar la Mercury IO | **Cuentas →** abre Mercury IO **→ Pagar tarjeta**. Registra el 1.5% de cashback solo. |
| Cuadrar con el banco | **Cuentas →** abre la cuenta **→ Conciliar**. |
| Nuevo producto, categoría o proveedor | **Catálogos**. El dashboard y los reportes lo incluyen solos. |
| Dar acceso a alguien | **Usuarios → Nuevo usuario** (y **Nuevo rol** si necesitas permisos a la medida). Cada quien pone su cargo en **Mi perfil**. |
| Topes de gasto y objetivos | **Planeación → Presupuestos / Metas**. Las alertas avisan si te pasas o vas atrasado. |
| Preguntar o pedir un cambio | Botón **Asistente** (abajo a la derecha). Propone; tú confirmas. |
| Ordenar el dashboard | **Personalizar** (arriba a la derecha del dashboard). |

Cuando se abra Mercury: en **Cuentas**, edita Mercury Checking / Savings / IO y cámbialas a **Activa**.

## Reglas contables (automáticas)

- **P&L**: ingreso neto (bruto − comisiones) − costos directos = utilidad bruta; − gastos operativos − costos financieros = utilidad neta.
- **Caja**: solo cuentas de la LLC. Saldo = saldo inicial + movimientos.
- **Aportes del dueño**: lo pagado con dinero personal es gasto en el P&L **y** aporte de capital (ya pagado; no queda deuda). Nunca sale de la caja de la LLC. Es privado: solo el dueño lo ve, desde su menú de usuario.
- **Caja vs. plataformas**: la caja son solo los bancos de la LLC. El saldo de Skool es facturación por cobrar y solo sale por payout.
- **Estados financieros**: el balance general siempre debe cuadrar (activos = pasivos + patrimonio); los tests lo verifican después de cada tipo de operación.
- **Moneda**: todo se reporta en USD. Cada movimiento guarda la tasa USD/HNL de su fecha; la tasa del día se actualiza sola.

La lógica vive en `lib/services/ledger.ts` (qué ledger afecta cada captura) y `lib/finance/engine.ts` (métricas). Ambas tienen tests.

## Desarrollo

```bash
npm install
npm run dev          # http://localhost:3001 — sin DATABASE_URL usa un Postgres local (PGlite) en ~/.inversiones101
npm test             # motor de cálculo + reglas contables
npm run typecheck && npm run lint
```

El primer ingreso muestra la pantalla para crear la cuenta de **Administrador**.

### Producción

- Sitio: https://finance.inversiones101.lat (también https://inversiones101-finanzas.vercel.app; proyecto `inversiones101-finanzas`, equipo Inversiones101 LLC).
- Dominio: CNAME `finance` en GoDaddy → Vercel; certificado Let's Encrypt renovado automáticamente por Vercel.
- Base: Neon (plan Free, región `iad1`), conectada desde Vercel Marketplace; crea `DATABASE_URL` y `DATABASE_URL_UNPOOLED`.
- Publicar cambios: `npx vercel deploy --prod`.
- Asistente de IA: requiere `ANTHROPIC_API_KEY` en las variables de Vercel (modelo `claude-opus-5`, con respaldo automático). Sin la clave, el panel avisa que falta configurarla.
- Cambios de esquema: edita `db/schema.ts` → `npm run db:generate` → aplica con las variables de producción:
  `npx vercel env pull /tmp/prod.env --environment production` y luego `set -a; . /tmp/prod.env; set +a; npx drizzle-kit migrate` (borra el archivo al terminar).
- ⚠️ No uses `vercel env pull` sin `--environment` hacia `.env.local`: traería la base de producción a tu entorno local.

## Mapa del código

```
app/                 páginas (una por módulo) + login
components/crud/     formularios, tablas y diálogos reutilizables
components/forms/    campos de ingresos y gastos
db/schema.ts         esquema (23 tablas) · db/seed.ts datos iniciales
lib/actions/         server actions: validan permiso, corren en transacción, dejan bitácora
lib/services/        reglas contables
lib/finance/         motor de métricas y reportes
lib/auth/            contraseñas (scrypt), sesiones y permisos
tests/               vitest sobre Postgres en memoria
```
