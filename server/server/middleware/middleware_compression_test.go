
package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCrossOriginAllowsConfiguredSite(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS", "")

	req := httptest.NewRequest(http.MethodGet, "/api/AI/Capabilities", nil)
	req.Header.Set("Origin", defaultAllowedOrigin)
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}

	CrossOriginMiddleware(rec, req, next)

	if !called {
		t.Fatal("expected allowed origin to reach handler")
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != defaultAllowedOrigin {
		t.Errorf("unexpected allowed origin: %s",
			rec.Header().Get("Access-Control-Allow-Origin"))
	}

	if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Error("expected credentials to be allowed")
	}

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestCrossOriginRejectsUnknownSite(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS", "")

	req := httptest.NewRequest(http.MethodGet, "/api/AI/Capabilities", nil)
	req.Header.Set("Origin", "https://unknown.example")
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
	}

	CrossOriginMiddleware(rec, req, next)

	if called {
		t.Error("unknown origin must not reach handler")
	}

	if rec.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rec.Code)
	}
}

func TestCrossOriginHandlesPreflight(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS", "")

	req := httptest.NewRequest(http.MethodOptions, "/api/AI/Agent", nil)
	req.Header.Set("Origin", defaultAllowedOrigin)
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "authorization,x-byok-key")
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
	}

	CrossOriginMiddleware(rec, req, next)

	if called {
		t.Error("preflight must not reach the next middleware")
	}

	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rec.Code)
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != defaultAllowedOrigin {
		t.Error("expected allowed origin header")
	}
}

func TestCrossOriginAllowsConfiguredAdditionalOrigin(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS",
		"https://3dweb.iceiy.com, http://localhost:5173")

	req := httptest.NewRequest(http.MethodGet, "/api/AI/Capabilities", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}

	CrossOriginMiddleware(rec, req, next)

	if !called {
		t.Fatal("configured additional origin should be allowed")
	}

	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Error("unexpected origin header")
	}
}
