
package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCrossOriginAllowsDefaultFrontend(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS", "")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
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
		t.Errorf("unexpected allowed origin: %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestCrossOriginRejectsUnknownOrigin(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS", "")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "https://unknown.example")
	rec := httptest.NewRecorder()

	called := false
	CrossOriginMiddleware(rec, req, func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

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
	rec := httptest.NewRecorder()

	called := false
	CrossOriginMiddleware(rec, req, func(w http.ResponseWriter, r *http.Request) {
		called = true
	})

	if called {
		t.Error("preflight must not reach the next handler")
	}
	if rec.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != defaultAllowedOrigin {
		t.Error("expected allowed origin header")
	}
	if rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Error("expected allowed methods header")
	}
}

func TestCrossOriginAllowsConfiguredAdditionalOrigin(t *testing.T) {
	t.Setenv("AI_ALLOWED_ORIGINS", defaultAllowedOrigin+", http://localhost:5173")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	rec := httptest.NewRecorder()

	called := false
	CrossOriginMiddleware(rec, req, func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	if !called {
		t.Fatal("configured additional origin should be allowed")
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:5173" {
		t.Error("unexpected Access-Control-Allow-Origin")
	}
}
