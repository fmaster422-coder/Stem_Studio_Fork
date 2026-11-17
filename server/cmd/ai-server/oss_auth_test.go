
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dotErth/ai-3d-sandbox/stemstudio/server/constants"
)

func TestOSSAuthAcceptsConfiguredToken(t *testing.T) {
	t.Setenv("AI_SERVER_TOKEN", "test-secret-value")

	req := httptest.NewRequest(http.MethodPost, "/api/AI/Agent", nil)
	req.Header.Set("Authorization", "Bearer test-secret-value")
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true

		params, ok := r.Context().Value("auth_params").(map[string]interface{})
		if !ok {
			t.Fatal("expected auth_params in request context")
		}

		token, ok := params["token"].(*ossLocalIdentity)
		if !ok || token.UID != ossUserID {
			t.Errorf("unexpected identity: %#v", params["token"])
		}

		if params["authority"] != constants.User {
			t.Errorf("expected authority %v, got %#v", constants.User, params["authority"])
		}

		if params["isAdmin"] != true {
			t.Error("expected isAdmin=true")
		}

		w.WriteHeader(http.StatusOK)
	}

	ossAuthMiddleware(rec, req, next)

	if !called {
		t.Errorf("expected handler call, got status %d", rec.Code)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestOSSAuthRejectsWrongToken(t *testing.T) {
	t.Setenv("AI_SERVER_TOKEN", "test-secret-value")

	req := httptest.NewRequest(http.MethodPost, "/api/AI/Agent", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
	}

	ossAuthMiddleware(rec, req, next)

	if called {
		t.Error("wrong token must not reach the handler")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestOSSAuthRejectsMissingToken(t *testing.T) {
	t.Setenv("AI_SERVER_TOKEN", "test-secret-value")

	req := httptest.NewRequest(http.MethodPost, "/api/AI/Agent", nil)
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
	}

	ossAuthMiddleware(rec, req, next)

	if called {
		t.Error("missing token must not reach the handler")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestOSSAuthRejectsUnconfiguredServer(t *testing.T) {
	t.Setenv("AI_SERVER_TOKEN", "")

	req := httptest.NewRequest(http.MethodPost, "/api/AI/Agent", nil)
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
	}

	ossAuthMiddleware(rec, req, next)

	if called {
		t.Error("handler must not run without server configuration")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503, got %d", rec.Code)
	}
}

func TestOSSAuthBypassesPublicHealthRoute(t *testing.T) {
	t.Setenv("AI_SERVER_TOKEN", "")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()

	called := false
	next := func(w http.ResponseWriter, r *http.Request) {
		called = true
		if r.Context().Value("auth_params") != nil {
			t.Error("public health route must not receive auth_params")
		}
		w.WriteHeader(http.StatusOK)
	}

	ossAuthMiddleware(rec, req, next)

	if !called {
		t.Errorf("expected health handler call, got status %d", rec.Code)
	}
	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}


func TestOSSAuthBypassesHeadHealthRoute(t *testing.T) {
    t.Setenv("AI_SERVER_TOKEN", "")

    req := httptest.NewRequest(http.MethodHead, "/", nil)
    rec := httptest.NewRecorder()

    called := false
    next := func(w http.ResponseWriter, r *http.Request) {
        called = true
        w.WriteHeader(http.StatusOK)
    }

    ossAuthMiddleware(rec, req, next)

    if !called {
        t.Errorf("expected HEAD health handler call, got status %d", rec.Code)
    }
    if rec.Code != http.StatusOK {
        t.Errorf("expected 200, got %d", rec.Code)
    }
}