# Dock Glass

[English](README.md) · **Español**

[![CI](https://github.com/atarico/dock-glass/actions/workflows/ci.yml/badge.svg)](https://github.com/atarico/dock-glass/actions/workflows/ci.yml)

Una extensión de GNOME Shell que hace que Ubuntu Dock o Dash to Dock se sientan como el Dock de macOS: una píldora de vidrio, íconos que se agrandan de forma continua y se separan bajo el puntero, un rebote al abrir una aplicación, ventanas que se abren con un efecto genio desde su ícono y una pila de lugares al estilo macOS que sale del ícono de Archivos.

> [!NOTE]
> **Proyecto en etapa temprana.** Desarrollado y probado en Ubuntu 24.04, GNOME Shell 46 sobre X11, con Ubuntu Dock abajo, íconos de 48 px y el tema Yaru. Por ahora los valores son fijos; está prevista una ventana de preferencias. Todavía no está en [extensions.gnome.org](https://extensions.gnome.org).

## Así se ve

https://github.com/user-attachments/assets/bd634c8b-6130-4676-b36d-0bb86aa4d3ca

*La magnificación y la píldora de vidrio, sobre el Liquid Glass de Blur My Shell (grabación con zoom).*

https://github.com/user-attachments/assets/d73059d8-f738-452c-ac48-0fbdbee42390

*La pila de lugares de Archivos: las carpetas salen del ícono, vuelven a entrar en él al cerrarse y se abren con un clic.*

https://github.com/user-attachments/assets/dc25134f-0db5-4ce9-8d47-6a419962a23b

*Minimizar y restaurar: la ventana entra en el lugar de reposo del ícono en el dock y vuelve a salir de él.*

## Funciones

| Función | Qué se ve |
|---------|-----------|
| Magnificación | Los íconos crecen desde su borde inferior a medida que el puntero se mueve sobre el dock: 1,4x bajo el puntero y de vuelta al tamaño normal tres íconos más allá. Como en macOS, ningún ícono se achica: los vecinos se separan y la píldora se ensancha para contenerlos |
| Píldora de vidrio | Un dock completamente redondeado con un borde interior claro, pensado para usarse sobre el Liquid Glass de Blur My Shell |
| Rebote al abrir | Un ícono rebota hasta que la aplicación que abrió muestra su ventana |
| Genio | Las ventanas entran en su ícono del dock al minimizarse y vuelven a salir de él al restaurarse, y las ventanas nuevas salen de él al abrirse, desde donde se dibuja aunque esté agrandado. La ventana se encuentra con el dock en el borde superior de su píldora, así nunca pasa por detrás del dock. Reemplaza las animaciones de GNOME. macOS usa el genio solo para minimizar y restaurar; el genio al abrir es un agregado de Dock Glass |
| Pila de lugares de Archivos | Sin ventanas de Archivos abiertas, un clic en su ícono despliega en abanico los lugares (carpeta personal, Escritorio, Documentos, Descargas, Imágenes y marcadores). Los elementos salen del ícono y vuelven a entrar en él cuando la pila se cierra. Con ventanas de Archivos abiertas, el clic funciona como siempre |
| Archivos junto a la Papelera | Cuando Archivos es la última aplicación anclada, el separador pasa a su izquierda, así Archivos queda junto a la Papelera como las carpetas del Dock de macOS |
| Punto de ejecución | Un punto pequeño debajo de cada aplicación abierta |

Dock Glass hace el genio al minimizar y restaurar por su cuenta, así que ya no necesita [Magic Lamp](https://github.com/hermes83/compiz-alike-magic-lamp-effect). Si Magic Lamp está instalado, conviene desactivarlo: mientras está activado, Dock Glass le deja minimizar y restaurar.

## Instalación

1. Clonar el repositorio en la carpeta de extensiones. El nombre de la carpeta tiene que ser el UUID de la extensión:
   ```sh
   git clone https://github.com/atarico/dock-glass.git \
     ~/.local/share/gnome-shell/extensions/dock-glass@atarico.github.io
   ```
2. Reiniciar GNOME Shell. En X11, presionar `Alt+F2`, escribir `r` y presionar Enter. En Wayland, cerrar sesión y volver a entrar.
3. Activarla:
   ```sh
   gnome-extensions enable dock-glass@atarico.github.io
   ```
4. Pasar el puntero sobre el dock: el ícono que está debajo crece por encima de la píldora y sus vecinos se separan.

Para actualizar, ejecutar `git pull` en esa carpeta y reiniciar GNOME Shell. Para desinstalar, ejecutar `gnome-extensions disable dock-glass@atarico.github.io` y borrar la carpeta.

**Traducciones.** Un clon no trae las traducciones compiladas, así que los textos de la pila se ven en inglés. Para verlos en tu idioma (por ahora, español), ejecutar `sh scripts/build-locale.sh` en esa carpeta, que necesita gettext (`sudo apt install gettext` en Ubuntu), y reiniciar GNOME Shell. Volver a ejecutarlo después de cada `git pull`.

**¿La instalaste como `dock-glass@local`?** Las versiones anteriores usaban ese UUID, y GNOME Shell solo carga una extensión desde una carpeta con el nombre de su UUID. Renombrar la carpeta a `dock-glass@atarico.github.io`, reiniciar GNOME Shell y volver a activarla con el comando de arriba.

## Configuración recomendada

Dock Glass da estilo y anima al dock; el aspecto completo también depende de algunos ajustes fuera de la extensión.

**El dock.** Un fondo transparente (el vidrio lo pone Blur My Shell), un clic que enfoca o minimiza y un solo punto de ejecución:

```sh
gsettings set org.gnome.shell.extensions.dash-to-dock transparency-mode 'FIXED'
gsettings set org.gnome.shell.extensions.dash-to-dock background-opacity 0.0
gsettings set org.gnome.shell.extensions.dash-to-dock click-action 'focus-minimize-or-previews'
gsettings set org.gnome.shell.extensions.dash-to-dock running-indicator-style 'DEFAULT'
```

Con Dash to Dock de extensions.gnome.org, configurar esas mismas cuatro opciones en su ventana de preferencias.

**Archivos.** Anclar Archivos como la última aplicación, para que quede junto a la Papelera.

**Blur My Shell** ([extensión](https://github.com/aunetx/blur-my-shell)). En sus preferencias, para el dock:

| Ajuste | Valor |
|--------|-------|
| Static blur (desenfoque estático) | Desactivado, para que el vidrio desenfoque lo que realmente está detrás del dock |
| Pipeline | Un solo efecto "Liquid Glass": blur radius 10, edge size 16, tint 0, shadow 0.1, specular strength 0.6 |

**Complemento opcional.** [Burn My Windows](https://github.com/Schneegans/Burn-My-Windows) para los efectos de cierre; Dock Glass le deja el cierre de ventanas. Desactivar sus efectos de apertura, así las ventanas nuevas solo tienen el genio. Desactivar Magic Lamp si está instalado: Dock Glass minimiza y restaura por su cuenta, y se lo deja a Magic Lamp mientras está activado.

## Compatibilidad

| Componente | Estado |
|------------|--------|
| GNOME Shell 46 a 51 | Soportado; cada versión probada en vivo (ver abajo) |
| GNOME Shell 52 y posteriores | Todavía sin probar; `metadata.json` declara de la 46 a la 51 |
| Ubuntu Dock (`ubuntu-dock@ubuntu.com`) | Soportado; hace falta uno de los dos docks |
| Dash to Dock (`dash-to-dock@micxgx.gmail.com`) | Soportado; mientras está activado reemplaza a Ubuntu Dock, y Dock Glass lo sigue |
| Posición del dock | Solo abajo; los docks laterales quedan sin cambios |
| X11 | Probado |
| Wayland | Sin probar |

### Otras versiones de GNOME y otras distros

Las demás distros usan Dash to Dock, desde sus paquetes o desde extensions.gnome.org. Una versión de GNOME entra en `shell-version` de `metadata.json` solo después de probarla en vivo. Cada versión de la lista se probó en un GNOME Shell sin pantalla (headless), con un puntero virtual y capturas, usando el dock que trae su distro:

| GNOME Shell | Distro | Dock |
|-------------|--------|------|
| 46 | Ubuntu 24.04 | Ubuntu Dock |
| 47 | Ubuntu 24.10 | Ubuntu Dock |
| 48 | Debian 13 | Dash to Dock |
| 49 | Fedora 43 | Dash to Dock |
| 50 | Ubuntu 26.04 | Ubuntu Dock |
| 51 | Ubuntu 26.10 | Ubuntu Dock |

Cada prueba cubrió la magnificación, la pila de lugares (en abanico y en cuadrícula), abrir una aplicación desde el dock, el genio al abrir, y desactivar y volver a activar Dock Glass, sin errores de Dock Glass en el registro. Dos cambios de GNOME afectan a Dock Glass, y `shellCompat.js` maneja ambos: GNOME 50 eliminó `Clutter.Grab.get_seat_state()`, y GNOME 51 eliminó la propiedad `vertical` de `St.BoxLayout` en favor de `orientation`, que se agregó en GNOME 48.

Para probar una versión a mano, usar una máquina virtual (por ejemplo, GNOME Boxes) con una distro que la traiga, como las de arriba.

1. En la máquina virtual, si la distro no trae Ubuntu Dock, instalar Dash to Dock desde extensions.gnome.org.
2. En tu equipo, agregar la versión a `shell-version`, ejecutar `sh scripts/pack.sh` y copiar el zip de `dist/` a la máquina virtual.
3. Ahí, ejecutar `gnome-extensions install --force dock-glass@atarico.github.io.shell-extension.zip`, cerrar sesión y volver a entrar, y ejecutar `gnome-extensions enable dock-glass@atarico.github.io`.
4. Usar el dock mientras `journalctl -f -o cat /usr/bin/gnome-shell` corre en una terminal, y buscar errores.

## Limitaciones conocidas

- **Valores fijos.** El tamaño máximo de la magnificación, su alcance y el vidrio son fijos hasta que exista la ventana de preferencias.
- **Traducciones.** Los textos de la pila de lugares están traducidos solo al español; en otros idiomas se ven en inglés. Los nombres de las carpetas vienen del sistema.
- **Agrupación del separador.** Las aplicaciones abiertas que no están ancladas siguen apareciendo entre Archivos y la Papelera.
- **Activación con el teclado.** Abrir Archivos desde el teclado (Enter sobre un ícono con foco, o `Super`+número) sin ventanas de Archivos también abre la pila de lugares.
- **Partes internas del dock.** La extensión se engancha a partes privadas del dock, que Ubuntu Dock y Dash to Dock comparten, así que una actualización del dock puede romperla. Todas se usan a través de `dockAdapter.js`, el único archivo a adaptar cuando eso pase.
- **Cambiar de dock.** Después de activar o desactivar Ubuntu Dock o Dash to Dock, reiniciar GNOME Shell (en X11, `Alt`+`F2` y después `r`; en Wayland, cerrar sesión y volver a entrar). Ubuntu Dock no se recupera de un cambio con el shell en marcha, y Dock Glass toma el dock nuevo recién después del reinicio.

<details>
<summary><strong>Cómo funciona</strong></summary>

- **Espacio superior.** Ubuntu Dock recorta su contenido. La hoja de estilos aumenta el relleno superior de los íconos y agrega el mismo margen superior al fondo de la píldora, así la píldora mantiene su tamaño y el ícono más grande puede sobresalir por encima. A los costados, la extensión desactiva el recorte de la vista con desplazamiento y ensancha el recorte del contenedor deslizante, que Ubuntu Dock restablece en cada asignación de tamaño, para que los íconos separados y el vidrio más ancho sigan visibles.
- **Magnificación.** Un `Clutter.Timeline` por dock lee el puntero en cada cuadro mientras está sobre la píldora. `magnifier.js` convierte la distancia de cada ícono al puntero suavizado en una escala (una caída coseno), y el ancho extra de los íconos intermedios en un desplazamiento lateral. La extensión los aplica solo como transformaciones: la escala en cada ícono, el desplazamiento en su botón (así el punto de ejecución lo sigue) y en el separador, y una escala y un desplazamiento horizontales en el fondo de la píldora, que el vidrio de Blur My Shell sigue. Las asignaciones de tamaño del dock nunca cambian, así que su región de entrada, el ocultamiento inteligente y los destinos al minimizar mantienen su geometría de reposo. El ciclo se detiene cuando los íconos se estabilizan, se reinicia con el movimiento del puntero y vuelve exactamente al diseño de reposo cuando el puntero se va.
- **Eventos.** Los eventos del puntero vienen de `dashtodockBox`, la caja reactiva del dock que sigue el paso del puntero. Clutter no pasa eventos a través del contenedor del dock, que no es reactivo.
- **Pilas.** Archivos recibe un reemplazo de `activate` en su instancia que abre la pila de lugares solo con un clic izquierdo simple y sin ventanas de Archivos. La pila es un actor transparente que cubre todo el escenario bajo `Main.pushModal`, y se cierra con un clic afuera, un clic en el ícono o Escape. El dock sigue visible mientras está abierta gracias al estado de menú de elementos de Ubuntu Dock. La opacidad se anima por separado del movimiento elástico, porque Clutter la guarda en 8 bits y un modo de animación que se pasa de largo la haría dar la vuelta.
- **Genio.** Un envoltorio de `Main.wm._shouldAnimateActor` omite la animación de apertura de GNOME para las ventanas normales de aplicaciones, y un manejador de `map` agrega en su lugar el efecto de deformación del genio. Parte del ícono del dock de la aplicación tal como se dibuja en ese momento, en el monitor de la ventana cuando la aplicación tiene un ícono ahí. La punta del genio queda en el borde interno del dock (el borde superior de la píldora de un dock inferior) en lugar del borde de la pantalla, así la ventana nunca pasa por detrás del dock; `genieGeometry.js` mide ese borde, y mientras el dock está oculto el genio sigue usando el borde de la pantalla. Minimizar y restaurar pasan por el mismo envoltorio, pero sin animación GNOME los completa en el acto y oculta o muestra la ventana antes de cualquier genio. Por eso Dock Glass también envuelve `completed_minimize` y `completed_unminimize` del gestor de ventanas: para las ventanas que tomó, retiene la llamada y la hace cuando el genio termina, o cuando se descarta porque empieza el efecto siguiente, la ventana se cierra, se abre la vista general o se desactiva Dock Glass. Minimizar y restaurar apuntan al lugar de reposo del ícono, el destino de minimizado que publica el dock. Se toman solo cuando GNOME los animaría, así que un efecto omitido (el selector de ventanas restaura sin efecto) y la vista general mantienen el comportamiento de GNOME, y mientras Magic Lamp está activado su propio envoltorio los rechaza y se los deja a él. Una ventana X11 se mapea antes de que su aplicación la dibuje, así que en X11 el genio de una ventana nueva espera dentro del ícono hasta que la ventana se repinta por primera vez, como mucho 1,5 s. El genio lleva su propio tiempo y avanza como mucho un cuadro de 30 fps por cuadro dibujado, así una aplicación que frena el compositor al arrancar (Brave, VS Code) lo hace más lento en lugar de saltarse su comienzo. Los envoltorios se retiran solo mientras siguen siendo los más externos, así conviven sin problemas con Burn My Windows y Magic Lamp.
- **Separador.** Ubuntu Dock vuelve a insertar el separador después de las aplicaciones ancladas en cada redibujado. Cuando el ícono anterior es Archivos, la extensión lo mueve un lugar a la izquierda antes del siguiente cuadro. El separador no es un elemento de aplicación, así que la lista de aplicaciones del dock y el arrastrar y soltar no se ven afectados. Al desactivar la extensión, el movimiento se deshace.

</details>

## Desarrollo

| Archivo | Función |
|---------|---------|
| `extension.js` | Se engancha al dock: magnificación, recortes, separador, pila de Archivos, rebote al abrir |
| `dockAdapter.js` | El único acceso a las partes privadas de Ubuntu Dock y Dash to Dock: cómo se carga el módulo de cada dock instalado, cuál está corriendo, su administrador de docks y los actores de cada dock |
| `genieAnimation.js` | Reemplaza las animaciones de apertura, minimizado y restauración por el genio |
| `genieEffect.js` | El efecto de deformación del genio |
| `genieGeometry.js` | Matemática pura del genio: las etapas con que sale la ventana y el borde interno del dock |
| `magnifier.js` | Matemática pura de la magnificación |
| `stack.js` | La ventana emergente de la pila: actores, animaciones, entrada |
| `stackLayout.js` | Matemática pura de la disposición de la pila |
| `shellCompat.js` | Las diferencias entre GNOME Shell 46 y 51 que maneja Dock Glass, como funciones puras |
| `stylesheet.css` | Estilos de la píldora, el espacio superior, el punto de ejecución y la pila |
| `po/` | Traducciones, un `<idioma>.po` por idioma |
| `scripts/build-locale.sh` | Compila `po/` en `locale/`, donde GNOME Shell las lee |
| `scripts/pack.sh` | Genera el zip instalable, con las traducciones |
| `scripts/genie-check/` | Prueba del genio con ventanas reales en un GNOME Shell sin pantalla, en Docker |
| `.github/workflows/ci.yml` | Pruebas, verificación de sintaxis y empaquetado en GitHub Actions, más versiones publicadas con etiquetas `v*` |

La matemática pura y el adaptador del dock no importan nada de GNOME, así que Node.js 22 o más nuevo puede probarlos desde la raíz del repositorio:

```sh
node --test
```

La misma ejecución también comprueba que los imports relativos de los módulos de la raíz del repositorio solo apunten entre ellos, que `metadata.json` esté completo y que cada archivo de `po/` traduzca exactamente los textos que el código pasa a `_()`. Para generar en `dist/` el archivo que acepta `gnome-extensions install` (necesita gettext):

```sh
sh scripts/pack.sh
```

GitHub Actions ejecuta las pruebas, una verificación de sintaxis de cada módulo y el empaquetado en cada pull request y en cada push a `main`. Al subir una etiqueta `v*`, además publica una versión en GitHub con el zip empaquetado.

El resto del lado de GNOME Shell no tiene pruebas automáticas en CI. El genio, que retiene el minimizado y la restauración del gestor de ventanas hasta terminar, tiene una prueba en un GNOME Shell sin pantalla dentro de Docker (unos cuatro minutos con la imagen ya construida, 1,5 GB de disco por imagen): ventanas GTK reales (una de ellas cliente X11) se abren, minimizan y restauran mientras Dock Glass y Magic Lamp se activan y desactivan, y cada minimizado y restauración debe completarse exactamente una vez.

```sh
sh scripts/genie-check/run.sh 46   # o 51
```

Para desarrollar, crear un enlace simbólico al clon en lugar de clonar dentro de la carpeta de extensiones:

```sh
ln -s "$PWD" ~/.local/share/gnome-shell/extensions/dock-glass@atarico.github.io
```

Reiniciar GNOME Shell después de cada cambio y ver los errores con:

```sh
journalctl -f -o cat /usr/bin/gnome-shell
```

## Licencia

[GPL-3.0 o posterior](LICENSE). Copyright (C) 2026 atarico.

`genieEffect.js` está adaptado de los efectos de minimizado y restauración de [Compiz alike magic lamp effect](https://github.com/hermes83/compiz-alike-magic-lamp-effect), de hermes83 (GPL-3.0 o posterior).
