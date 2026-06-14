# Skill Lifecycle - Jarvis Codex

## Principio

Las skills son una forma de transformar aprendizaje en capacidad reutilizable.

## Estados de Skill

- `idea`: necesidad detectada.
- `draft`: skill propuesta.
- `sandbox`: implementada en entorno seguro.
- `testing`: bajo prueba.
- `approved`: habilitada por usuario o politica.
- `active`: disponible para uso normal.
- `mature`: probada repetidamente con buenos resultados.
- `deprecated`: reemplazada o no recomendada.
- `disabled`: apagada por seguridad o preferencia.

## Contrato de Skill

Cada skill debe tener:

- Nombre.
- Objetivo.
- Entradas.
- Salidas.
- Herramientas permitidas.
- Riesgo.
- Politica de aprobacion.
- Pruebas.
- Version.
- Autor: sistema, usuario, agente o importada.
- Logs.

## Promocion a Skill

Una tarea puede convertirse en skill cuando:

- Se repite.
- Tiene pasos estables.
- Produce valor claro.
- Tiene parametros identificables.
- Puede validarse.
- Puede ejecutarse con menor costo cognitivo.

## Versionado

Las skills deben poder:

- Actualizarse.
- Probarse.
- Compararse.
- Volver a version anterior.
- Desactivarse.

## Crecimiento Local

Jarvis debe poder crear y mejorar skills dentro del computador del usuario. Esto no requiere una tienda central ni una nube propietaria.

Flujo esperado:

1. Detecta una tarea repetida.
2. Propone convertirla en skill.
3. Genera contrato y pruebas.
4. Ejecuta en sandbox.
5. Compara resultado con ejecuciones anteriores.
6. Pide aprobacion si la skill toca datos, conectores o acciones sensibles.
7. Activa la skill.
8. Mide desempeno y costo.

## Skills Importadas

Tambien pueden existir skills importadas o packs oficiales/opcionales, pero deben pasar por el mismo contrato local:

- Leer manifiesto.
- Mostrar permisos.
- Validar origen.
- Probar en sandbox.
- Permitir desactivar.
- Permitir rollback.

## Seguridad

Skills con acciones externas, destructivas o de codigo requieren permisos explicitos. Una skill madura no debe saltarse politicas de seguridad.
