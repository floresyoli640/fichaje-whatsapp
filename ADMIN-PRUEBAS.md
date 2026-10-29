# Gestión administrativa por WhatsApp (PRUEBAS)

Esta rama NO debe desplegarse todavía. Mantiene ENTRADA/SALIDA y sus recordatorios.

## Variables privadas de Railway
- `ADMIN_WHATSAPP`: número del administrador con prefijo internacional (no guardarlo en GitHub).
- `FESTIVOS_UBEDA_2026`: fechas oficiales completas, separadas por comas en formato AAAA-MM-DD. Verificar festivos nacionales, Andalucía y Úbeda antes de activar.

## Comandos (solo chat individual del administrador)
- `RESUMEN`: muestra jornadas previstas y ausencias del día.
- `AUSENTE Nombre Apellidos`: registra una ausencia (nombre exacto y único).
- `CONFIRMAR TODOS`: declaración administrativa explícita de que se ha verificado la jornada habitual de los empleados no marcados como ausentes.

Las confirmaciones se guardan en `ConfirmacionesJornada`, **no** en `TimeEntries`, y no equivalen a fichajes de dispositivo/GPS. No se generan minutos aleatorios. El resumen se programa a las 15:05 (Europe/Madrid).

## Pendiente antes de producción
- Confirmar y configurar el calendario laboral oficial de Úbeda y actualizarlo cada año.
- Implementar correcciones de horarios reales y vacaciones, y resolver fichajes manuales existentes antes de la confirmación en bloque.
- Verificar autorización de WhatsApp (incluidos identificadores LID), permisos de lectura/escritura de Back4App y prevención de duplicados concurrentes.
- Probar en entorno aislado con datos ficticios; revisar política de retención y acceso.
- Trasladar credenciales Back4App presentes en `index.js` a variables de entorno y rotarlas.
- Verificar el comportamiento de Railway antes de desplegar: no fusionar esta rama hasta completar pruebas.

**Advertencia:** no usar `CONFIRMAR TODOS` para declarar como reales horas no comprobadas.
