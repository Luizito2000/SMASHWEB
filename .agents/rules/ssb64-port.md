# Directivas del Port SSB64 Web / PC

## Contexto y Arquitectura
- Port de Super Smash Bros. 64 basado en la decompilación (github.com/VetriTheRetri/ssb-decomp-re) integrado con libultraship (LUS) y el pipeline de assets Torch.
- Soporte para WebAssembly (Emscripten) y compilación nativa Windows.

## Reglas de Código y Compilación
1. **Preservación de Decompilación**:
   - Mantener modismos IDO necesarios para el juego, pero corregir o encapsular incompatibilidades modernas de tipos/punteros (`#if UINTPTR_MAX > ...`).
   - Evitar `if (dummy);` o advertencias de compilador; utilizar `(void)dummy;` para referencias limpias.
2. **Seguridad en tipos LP64 vs 32-bit (WASM)**:
   - Tener en cuenta que en WASM 32-bit `uintptr_t` es de 32 bits. Evitar comparaciones tautológicas con constantes de 64 bits sin condicionales de compilación.
3. **Verificación antes de finalizar**:
   - Comprobar que los cambios sintácticos y de tipos no introduzcan advertencias ni rompan submódulos (`decomp/`, `libultraship/`, `torch/`).
