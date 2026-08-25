#if defined(__EMSCRIPTEN__)
#include "coroutine.h"
#include "port_watchdog.h"
#include <emscripten/fiber.h>
#include <cstdio>
#include <cstdlib>

#define MIN_STACK_SIZE 32768
#define ASYNCIFY_STACK_SIZE (64 * 1024)

struct PortCoroutine {
    emscripten_fiber_t fiber;
    PortCoroutine* caller;
    void (*entry)(void*);
    void* arg;
    int finished;
    char* c_stack;
    char* asyncify_stack;
};

static emscripten_fiber_t sMainFiber;
static char sMainAsyncifyStack[ASYNCIFY_STACK_SIZE];
static PortCoroutine* sCurrentCoroutine = nullptr;

static void fiber_entry(void* opaque) {
    PortCoroutine* co = static_cast<PortCoroutine*>(opaque);
    std::fprintf(stderr, "SSB64: web fiber entered (entry=%p)\n", reinterpret_cast<void*>(co->entry));
    std::fflush(stderr);
    co->entry(co->arg);
    co->finished = 1;
    PortCoroutine* caller = co->caller;
    sCurrentCoroutine = caller;
    emscripten_fiber_swap(&co->fiber, caller ? &caller->fiber : &sMainFiber);
    std::abort();
}

extern "C" void port_coroutine_init_main(void) {
    emscripten_fiber_init_from_current_context(&sMainFiber, sMainAsyncifyStack, sizeof(sMainAsyncifyStack));
}

extern "C" PortCoroutine* port_coroutine_create(void (*entry)(void*), void* arg, size_t stack_size) {
    if (stack_size < MIN_STACK_SIZE) stack_size = MIN_STACK_SIZE;
    PortCoroutine* co = static_cast<PortCoroutine*>(std::calloc(1, sizeof(PortCoroutine)));
    if (!co) return nullptr;
    co->c_stack = static_cast<char*>(std::malloc(stack_size));
    co->asyncify_stack = static_cast<char*>(std::malloc(ASYNCIFY_STACK_SIZE));
    if (!co->c_stack || !co->asyncify_stack) {
        std::free(co->c_stack); std::free(co->asyncify_stack); std::free(co);
        return nullptr;
    }
    co->entry = entry; co->arg = arg;
    emscripten_fiber_init(&co->fiber, fiber_entry, co, co->c_stack, stack_size,
                          co->asyncify_stack, ASYNCIFY_STACK_SIZE);
    return co;
}

extern "C" void port_coroutine_destroy(PortCoroutine* co) {
    if (!co) return;
    if (co == sCurrentCoroutine) std::abort();
    std::free(co->c_stack); std::free(co->asyncify_stack); std::free(co);
}

extern "C" void port_coroutine_resume(PortCoroutine* co) {
    if (!co || co->finished) return;
    PortCoroutine* previous = sCurrentCoroutine;
    co->caller = previous; sCurrentCoroutine = co;
    emscripten_fiber_swap(previous ? &previous->fiber : &sMainFiber, &co->fiber);
    sCurrentCoroutine = previous;
}

extern "C" void port_coroutine_yield(void) {
    PortCoroutine* co = sCurrentCoroutine;
    if (!co) { std::fprintf(stderr, "SSB64: coroutine yield outside coroutine\n"); return; }
    port_watchdog_note_yield();
    PortCoroutine* caller = co->caller; sCurrentCoroutine = caller;
    emscripten_fiber_swap(&co->fiber, caller ? &caller->fiber : &sMainFiber);
    sCurrentCoroutine = co;
}

extern "C" int port_coroutine_is_finished(PortCoroutine* co) { return !co || co->finished; }
extern "C" int port_coroutine_in_coroutine(void) { return sCurrentCoroutine != nullptr; }
#endif
