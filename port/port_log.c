#include "port_log.h"

#include <stdio.h>
#include <stdarg.h>

#if defined(__EMSCRIPTEN__)
#include <emscripten/console.h>
#endif

static FILE *sLogFile = NULL;

void port_log_init(const char *path)
{
	if (sLogFile != NULL) return;
	sLogFile = fopen(path, "w");
}

void port_log_close(void)
{
	if (sLogFile != NULL) {
		fclose(sLogFile);
		sLogFile = NULL;
	}
}

int port_log_get_fd(void)
{
	if (sLogFile == NULL) return -1;
	return fileno(sLogFile);
}

void port_log(const char *fmt, ...)
{
	va_list ap;
	va_start(ap, fmt);
#if defined(__EMSCRIPTEN__)
	/* The browser cannot inspect the virtual log file while the UI thread is
	 * blocked. Mirror startup diagnostics to the JavaScript console so web
	 * port failures can be located without changing desktop logging. */
	va_list console_ap;
	va_copy(console_ap, ap);
	/* Bypass Emscripten's stdout/stderr hooks: the generated development shell
	 * appends stdout to a textarea and classifies stderr as an error. Updating
	 * that textarea for runtime diagnostics can make the page unresponsive. */
	char console_buf[2048];
	vsnprintf(console_buf, sizeof(console_buf), fmt, console_ap);
	emscripten_console_log(console_buf);
	va_end(console_ap);
#endif
	if (sLogFile != NULL) {
		vfprintf(sLogFile, fmt, ap);
	}
	va_end(ap);
	/* fflush on every call costs seconds per frame on a slow drive when
	 * figatree watchdogs fire 28x per frame during a stuck APPEAR. Rely on
	 * stdio's buffer + OS-on-exit flush for normal logging; crash dumps
	 * have their own flush path. */
}
