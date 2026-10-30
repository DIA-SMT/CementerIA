# Imágenes y logo de CementerIA

Procedencia de los archivos de esta carpeta (kit institucional entregado por
la Dirección de Inteligencia Artificial el 30/10/2026). Uso y medidas en
`docs/diseno.md`, sección "Imágenes".

## Logo

| Archivo | Medidas | Procedencia |
|---|---|---|
| `logo-municipal.png` | 910 × 297, PNG con transparencia | Logo oficial "Ciudad San Miguel de Tucumán" aportado por el usuario (`logo-municipal-proporcionado.png` del kit). Sin redibujar ni recolorear. |

El texto del logo es **blanco**: va solo sobre superficies azules u oscuras
(barra pública, panel de la foto del ingreso, barra lateral, pie). Sobre
fondos claros, dentro de un bloque azul institucional. Siempre con su
proporción y con el texto alternativo "Ciudad San Miguel de Tucumán".

## Imágenes

**Todas son composiciones conceptuales generadas con IA** (`manifest.json` del
kit: `conceptual_generated_not_actual_site_photo`). **No son fotografías de
cementerios de Tucumán** ni de ningún lugar real: se usan como ambientación,
nunca como prueba documental ni atribuidas a un establecimiento. Los mapas e
interfaces que aparecen dibujados en algunas no son datos ni pantallas reales.
Cuando la Dirección tenga fotos oficiales autorizadas, reemplazan a estas.

| Archivo | Medidas | Archivo de origen (kit) |
|---|---|---|
| `hero-landing.webp` | 1916 × 821 | paseo_memorial_entre_cipreses_y_luz_dorada.png |
| `hero-alternativo.webp` | 1672 × 941 | gestión_inteligente_del_cementerio_del_futuro.png |
| `hero-dashboard.webp` | 1672 × 941 | avenida_memorial_entre_niebla_crepuscular.png |
| `login-patrimonio.webp` | 1672 × 941 | paseo_sereno_entre_mausoleos.png |
| `feature-expedientes.webp` | 1672 × 941 | archivo_digital_en_la_avenida_de_la_memoria.png |
| `feature-ubicaciones.webp` | 1672 × 941 | mapa_digital_del_cementerio_moderno.png |
| `feature-gestion.webp` | 1672 × 941 | gestión_digital_del_cementerio_histórico.png |
| `feature-recorridos.webp` | 1672 × 941 | avenida_del_cementerio_con_mapa_digital.png |
| `feature-ambiental.webp` | 1672 × 941 | parque_memorial_sereno_entre_flores_y_árboles.png |
| `banner-patrimonio.webp` | 1672 × 941 | avenida_de_mausoleos_en_azul_sereno.png |
| `banner-tramites.webp` | 1672 × 941 | avenida_monumental_con_interfaz_digital.png |
| `fondo-suave.webp` | 1672 × 941 | paisaje_funerario_neoclásico_con_interfaz_etérea.png |

Versiones de 960 px de ancho (para `srcset` en celulares y tablets):

- `feature-ambiental-960.webp`: generada con sharp desde el original del kit
  (pesa 451 KB, más de 300 KB), calidad 72.
- `hero-landing-960.webp`, `login-patrimonio-960.webp`,
  `hero-dashboard-960.webp` y `banner-patrimonio-960.webp`: las versiones de
  960 px que el repositorio ya tenía de **las mismas imágenes** (antes en
  `public/imagenes/`, generadas con sharp desde los PNG originales del mismo
  paquete). Se movieron acá con su nombre nuevo: no son bytes nuevos.

El moodboard y la carpeta `referencias/` del kit **no** están en el
repositorio: son solo referencia de diseño.
