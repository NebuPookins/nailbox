"use strict";
var NailboxFrontend = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/frontend/index.js
  var index_exports = {};
  __export(index_exports, {
    default: () => index_default,
    mountGroupingRulesSettings: () => mountGroupingRulesSettings
  });

  // src/frontend/grouping_rules_island.jsx
  var { useEffect, useState } = React;
  var { createRoot } = ReactDOM;
  function createEmptyRule() {
    return {
      name: "New Rule",
      priority: 50,
      sortType: "mostRecent",
      conditions: []
    };
  }
  function normalizeRule(rule) {
    return {
      name: typeof rule?.name === "string" ? rule.name : "",
      priority: Number.isFinite(Number(rule?.priority)) ? Number(rule.priority) : 50,
      sortType: rule?.sortType === "shortest" ? "shortest" : "mostRecent",
      conditions: Array.isArray(rule?.conditions) ? rule.conditions.map((condition) => ({
        type: condition?.type === "sender_name" || condition?.type === "sender_email" || condition?.type === "subject" ? condition.type : "sender_email",
        value: typeof condition?.value === "string" ? condition.value : ""
      })) : []
    };
  }
  function GroupingRulesApp({ api, notify, onSaved, reloadToken }) {
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    useEffect(() => {
      let isCancelled = false;
      setLoading(true);
      setErrorMessage("");
      Promise.resolve(api.loadRules()).then((data) => {
        if (isCancelled) {
          return;
        }
        const nextRules = Array.isArray(data?.rules) ? data.rules.map(normalizeRule) : [];
        setRules(nextRules);
      }).catch(() => {
        if (isCancelled) {
          return;
        }
        setErrorMessage("Failed to load email grouping rules.");
        notify?.error?.("Failed to load email grouping rules");
      }).finally(() => {
        if (!isCancelled) {
          setLoading(false);
        }
      });
      return () => {
        isCancelled = true;
      };
    }, [api, notify, reloadToken]);
    function updateRule(ruleIndex, updater) {
      setRules((currentRules) => currentRules.map((rule, index) => index === ruleIndex ? updater(rule) : rule));
    }
    function addRule() {
      setRules((currentRules) => currentRules.concat(createEmptyRule()));
    }
    function removeRule(ruleIndex) {
      setRules((currentRules) => currentRules.filter((_, index) => index !== ruleIndex));
    }
    function addCondition(ruleIndex) {
      updateRule(ruleIndex, (rule) => ({
        ...rule,
        conditions: rule.conditions.concat({ type: "sender_email", value: "" })
      }));
    }
    function updateCondition(ruleIndex, conditionIndex, updater) {
      updateRule(ruleIndex, (rule) => ({
        ...rule,
        conditions: rule.conditions.map((condition, index) => index === conditionIndex ? updater(condition) : condition)
      }));
    }
    function removeCondition(ruleIndex, conditionIndex) {
      updateRule(ruleIndex, (rule) => ({
        ...rule,
        conditions: rule.conditions.filter((_, index) => index !== conditionIndex)
      }));
    }
    function saveRules() {
      setSaving(true);
      setErrorMessage("");
      Promise.resolve(api.saveRules({ rules })).then(() => {
        notify?.success?.("Email grouping rules saved successfully");
        onSaved?.();
      }).catch(() => {
        setErrorMessage("Failed to save email grouping rules.");
        notify?.error?.("Failed to save email grouping rules");
      }).finally(() => {
        setSaving(false);
      });
    }
    return /* @__PURE__ */ React.createElement("div", { className: "grouping-rules-app" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("div", { className: "col-xs-12" }, /* @__PURE__ */ React.createElement("p", null, "Configure how emails are grouped and prioritized. Rules are checked in order, and the first matching rule determines the group."), /* @__PURE__ */ React.createElement("button", { className: "btn btn-success", onClick: addRule, type: "button" }, /* @__PURE__ */ React.createElement("span", { className: "glyphicon glyphicon-plus" }), " Add New Rule"))), errorMessage ? /* @__PURE__ */ React.createElement("div", { className: "alert alert-danger", style: { marginTop: "15px" } }, errorMessage) : null, /* @__PURE__ */ React.createElement("div", { style: { marginTop: "15px", maxHeight: "500px", overflowY: "auto" } }, loading ? /* @__PURE__ */ React.createElement("p", { className: "text-muted" }, "Loading rules...") : rules.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "text-muted" }, "No rules defined yet.") : rules.map((rule, ruleIndex) => /* @__PURE__ */ React.createElement("div", { className: "panel panel-default", key: `${ruleIndex}-${reloadToken}`, style: { marginBottom: "15px" } }, /* @__PURE__ */ React.createElement("div", { className: "panel-heading" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-3" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-control",
        onChange: (event) => updateRule(ruleIndex, (currentRule) => ({ ...currentRule, name: event.target.value })),
        placeholder: "Rule Name",
        type: "text",
        value: rule.name
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-2" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-control",
        onChange: (event) => updateRule(ruleIndex, (currentRule) => ({
          ...currentRule,
          priority: Number.parseInt(event.target.value, 10) || 50
        })),
        placeholder: "Priority",
        type: "number",
        value: rule.priority
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-3" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "form-control",
        onChange: (event) => updateRule(ruleIndex, (currentRule) => ({ ...currentRule, sortType: event.target.value })),
        value: rule.sortType
      },
      /* @__PURE__ */ React.createElement("option", { value: "mostRecent" }, "Most Recent"),
      /* @__PURE__ */ React.createElement("option", { value: "shortest" }, "Shortest")
    )), /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-2" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger btn-sm", onClick: () => removeRule(ruleIndex), type: "button" }, /* @__PURE__ */ React.createElement("span", { className: "glyphicon glyphicon-trash" }), " Remove Rule")))), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, rule.conditions.length === 0 ? /* @__PURE__ */ React.createElement("p", { className: "text-muted" }, "No conditions defined.") : rule.conditions.map((condition, conditionIndex) => /* @__PURE__ */ React.createElement("div", { className: "row", key: `${ruleIndex}-${conditionIndex}`, style: { marginBottom: "10px" } }, /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-3" }, /* @__PURE__ */ React.createElement(
      "select",
      {
        className: "form-control",
        onChange: (event) => updateCondition(ruleIndex, conditionIndex, (currentCondition) => ({
          ...currentCondition,
          type: event.target.value
        })),
        value: condition.type
      },
      /* @__PURE__ */ React.createElement("option", { value: "sender_name" }, "Sender Name"),
      /* @__PURE__ */ React.createElement("option", { value: "sender_email" }, "Sender Email"),
      /* @__PURE__ */ React.createElement("option", { value: "subject" }, "Subject")
    )), /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-7" }, /* @__PURE__ */ React.createElement(
      "input",
      {
        className: "form-control",
        onChange: (event) => updateCondition(ruleIndex, conditionIndex, (currentCondition) => ({
          ...currentCondition,
          value: event.target.value
        })),
        placeholder: "Value to match",
        type: "text",
        value: condition.value
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "col-xs-12 col-sm-2" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-default btn-sm", onClick: () => removeCondition(ruleIndex, conditionIndex), type: "button" }, /* @__PURE__ */ React.createElement("span", { className: "glyphicon glyphicon-remove" }), " Remove")))), /* @__PURE__ */ React.createElement("button", { className: "btn btn-info btn-sm", onClick: () => addCondition(ruleIndex), type: "button" }, /* @__PURE__ */ React.createElement("span", { className: "glyphicon glyphicon-plus" }), " Add Condition"))))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "15px" } }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", disabled: loading || saving, onClick: saveRules, type: "button" }, saving ? "Saving..." : "Save Rules")));
  }
  function mountGroupingRulesIsland({ api, container, notify, onSaved }) {
    const root = createRoot(container);
    let reloadToken = 0;
    function renderApp() {
      root.render(
        /* @__PURE__ */ React.createElement(
          GroupingRulesApp,
          {
            api,
            notify,
            onSaved,
            reloadToken
          }
        )
      );
    }
    renderApp();
    return {
      refresh() {
        reloadToken += 1;
        renderApp();
      },
      unmount() {
        root.unmount();
      }
    };
  }

  // src/frontend/index.js
  async function readResponseError(response) {
    try {
      const body = await response.json();
      if (body && typeof body.humanErrorMessage === "string") {
        return body.humanErrorMessage;
      }
    } catch (error) {
    }
    return response.statusText || `Request failed with status ${response.status}`;
  }
  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        ...options.body ? { "Content-Type": "application/json" } : {},
        ...options.headers
      },
      ...options
    });
    if (!response.ok) {
      throw new Error(await readResponseError(response));
    }
    return response.json();
  }
  function createGroupingRulesApi() {
    return {
      loadRules() {
        return fetchJson("/api/email-grouping-rules");
      },
      saveRules(payload) {
        return fetchJson("/api/email-grouping-rules", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }
    };
  }
  function mountGroupingRulesSettings({ container, notify, onSaved }) {
    return mountGroupingRulesIsland({
      container,
      api: createGroupingRulesApi(),
      notify,
      onSaved
    });
  }
  var frontendApi = {
    mountGroupingRulesIsland,
    mountGroupingRulesSettings
  };
  if (typeof window !== "undefined") {
    window.NailboxFrontend = frontendApi;
    window.NailboxGroupingRules = {
      mount: mountGroupingRulesIsland,
      mountGroupingRulesIsland
    };
  }
  var index_default = frontendApi;
  return __toCommonJS(index_exports);
})();
