
package middleware

import (
	"net/http"
	"os"
	"strings"
)

const defaultAllowedOrigin = "https://3dweb.iceiy.com"

// allowedOrigins returns the explicitly authorized browser origins.
// AI_ALLOWED_ORIGINS accepts a comma-separated list.
func allowedOrigins() map[string]bool {
	origins := make(map[string]bool)

	configured := strings.TrimSpace(os.Getenv("AI_ALLOWED_ORIGINS"))
	if configured == "" {
		origins[defaultAllowedOrigin] = true
		return origins
	}

	for _, origin := range strings.Split(configured, ",") {
		origin = strings.TrimSpace(origin)
		if origin != "" {
			origins[origin] = true
		}
	}

	return origins
}

// CrossOriginMiddleware allows only configured browser origins.
// CORS is not authentication: protected API routes still require a valid token.
func CrossOriginMiddleware(w http.ResponseWriter, r *http.Request, next http.HandlerFunc) {
	origin := r.Header.Get("Origin")

	if origin == "" {
		if r.Method == http.MethodOptions {
			http.Error(w, "Origin not allowed", http.StatusForbidden)
			return
		}

		next(w, r)
		return
	}

	w.Header().Add("Vary", "Origin")

	if !allowedOrigins()[origin] {
		http.Error(w, "Origin not allowed", http.StatusForbidden)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", origin)
	w.Header().Set("Access-Control-Allow-Credentials", "true")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
	w.Header().Set(
		"Access-Control-Allow-Headers",
		"Content-Type, Authorization, Content-Encoding, X-Scene-Id, X-Asset-Get-Proxy-Base, X-Asset-Put-Proxy-Base, X-BYOK-Key, X-BYOK-Provider",
	)
	w.Header().Set("Access-Control-Max-Age", "600")

	// Browser preflight requests must finish before authentication middleware.
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	next(w, r)
}
