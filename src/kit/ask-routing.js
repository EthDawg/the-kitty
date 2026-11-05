/* Shared scope checks for optional model-assisted Ask. Only maskedQuestion crosses the model boundary. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.KittyAskRouting = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const dimensions = { times: "time", people: "person", categories: "category", goals: "goal" };
  const preparedRoutes = new WeakMap();
  const refused = (reason, status = "unsupported") => Object.freeze({ status, kind: "unsupported", reason });
  const isRecord = value => value !== null && typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const onlyKeys = (value, allowed) => isRecord(value) && Object.keys(value).every(key => allowed.includes(key));
  const validText = (value, limit) => typeof value === "string" && value.length <= limit && value.trim().length > 0 &&
    !/[\p{Cc}\p{Cf}]/u.test(value) && new TextEncoder().encode(value).length <= limit;
  const words = text => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[’']/g, "'").replace(/\b(what|how|where|when|who|it)'s\b/g, "$1 is")
    .replace(/\bwe've\b/g, "we have").replace(/\bwe're\b/g, "we are").replace(/\bdon't\b/g, "do not")
    .replace(/\bhaven't\b/g, "have not").match(/[\p{L}\p{N}]+/gu) || [];

  function dictionary(context) {
    if (!onlyKeys(context, [...Object.keys(dimensions), "asOf"])) return null;
    if ("asOf" in context && (typeof context.asOf !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(context.asOf))) return null;
    const byFirst = new Map();
    let count = 0;
    for (const [key, field] of Object.entries(dimensions)) {
      const options = key in context ? context[key] : [];
      if (!Array.isArray(options) || options.length > 256) return null;
      const ids = new Set();
      for (const value of options) {
        const option = typeof value === "string" && (field === "person" || field === "goal") ? { id: value, label: value } : value;
        if (!onlyKeys(option, ["id", "label", "aliases"]) || !validText(option.id, 160) || !validText(option.label, 160) || ids.has(option.id)) return null;
        if (field === "time" && !/^(?:current-month|last-month|\d{4}-(?:0[1-9]|1[0-2]))$/.test(option.id)) return null;
        ids.add(option.id);
        const aliases = "aliases" in option ? option.aliases : [];
        if (!Array.isArray(aliases) || aliases.length > 16 || !aliases.every(alias => validText(alias, 160))) return null;
        for (const name of new Set([option.id, option.label, ...aliases])) {
          const tokens = words(name);
          if (!tokens.length || ++count > 3000) return null;
          if (!byFirst.has(tokens[0])) byFirst.set(tokens[0], []);
          byFirst.get(tokens[0]).push({ field, id: option.id, tokens });
        }
      }
    }
    return byFirst;
  }

  function ground(input, aliases) {
    const scope = {}, masked = [];
    let subscriptionLabel = false;
    for (let index = 0; index < input.length;) {
      const candidates = (aliases.get(input[index]) || []).filter(alias => alias.tokens.every((word, n) => input[index + n] === word));
      if (!candidates.length) { masked.push(input[index++]); continue; }
      const length = Math.max(...candidates.map(alias => alias.tokens.length));
      const matches = candidates.filter(alias => alias.tokens.length === length);
      const { field, id } = matches[0];
      if (matches.some(alias => alias.field !== field || alias.id !== id) || (field in scope && scope[field] !== id)) return null;
      scope[field] = id;
      subscriptionLabel ||= field === "category" && length === 1 && /^subscriptions?$/.test(input[index]);
      masked.push("[" + field + "]");
      index += length;
    }
    let text = masked.join(" ");
    // The word “subscriptions” can be a category filter or the subject of a question about recurring services.
    if (subscriptionLabel && !/\b(?:spend|spent|spending|expenses|outgoings|expenditure|money went|money go)\b/.test(text)) {
      text = text.replaceAll("[category]", "subscriptions");
      delete scope.category;
    }
    return { text, scope };
  }

  // Every expression consumes the whole remaining question. Never discard an unknown noun or filter as filler.
  // A complete match runs locally, including when Apple Intelligence is unavailable.
  function whole(text, forms) { return forms.some(form => form.test(text)); }

  function spending(text) {
    const rest = text.replace(/\b(?:in|during|for|over) \[time\]/g, " ").replace(/\[time\]/g, " ")
      .replace(/\b(?:on|for|in) \[category\]/g, " ").replace(/\[category\]/g, " ")
      .replace(/\b(?:for|by) \[person\]/g, " ").replace(/\[person\] s\b/g, "our").replace(/\[person\]/g, "we")
      .replace(/\s+/g, " ").trim();
    return whole(rest, [
      /^(?:how much|what) (?:did|do|does|has|have) (?:we|our household|our family|the household) (?:spend|spent|shell out|fork out|pay out)$/,
      /^(?:how much|what) (?:is|was|were|are) (?:our |the household s |the family s )?(?:total |overall )?(?:spending|expenses|expenditure|outgoings|spend)$/,
      /^(?:our |the household s )?(?:total |overall )?(?:spending|expenses|expenditure|outgoings)$/,
      /^where (?:did (?:all )?(?:of )?our money go|has (?:all )?(?:of )?our money gone|our money went)$/,
      /^how much (?:went out|did we fork out|did we shell out)$/
    ]);
  }

  function coveredRoute(text, scope) {
    const utterance = text.replace(/^(?:please )?(?:(?:can|could|would) you (?:please )?)?/, "")
      .replace(/^(?:(?:tell|show|give) (?:me|us) |(?:list|show) )/, "").replace(/ please$/, "").trim();
    const fields = Object.keys(scope);
    if (fields.every(field => ["time", "person", "category"].includes(field)) && spending(utterance)) return "spending";
    if (fields.length === 1 && scope.goal && whole(utterance, [
      /^(?:how (?:is|s) |how close (?:is|are we to) |progress (?:on|toward|for) )?(?:our |the )?\[goal\](?: goal)?(?: going| doing| coming along| progressing| to (?:being |fully )?funded)?$/,
      /^when (?:will|can) (?:we (?:reach|fund|finish saving for) (?:our |the )?\[goal\]|(?:our |the )?\[goal\] be (?:fully )?funded)$/,
      /^are we on track (?:for|to reach) (?:our |the )?\[goal\]$/
    ])) return "goal";
    if (fields.length) return null;
    if (whole(utterance, [
      /^(?:our |the household s )?(?:total |available )?(?:cash|cash balance|liquid cash|cash and offset)(?: on hand)?$/,
      /^(?:what (?:is|was) (?:our |the household s )?(?:available |total )?(?:cash|cash balance|cash and offset)|how much (?:cash|liquid cash|cash and offset) (?:do we have|is available|is there))(?: on hand| available| now| right now)?$/,
      /^how much (?:liquid money|money on hand) (?:is available|do we have)$/
    ])) return "cash";
    if (whole(utterance, [
      /^(?:what is )?(?:our |the household s )?(?:net worth|total net worth|net wealth)(?: now| right now)?$/,
      /^what (?:are we|is our household|is our family) worth(?: after (?:our )?(?:debts|liabilities))?$/
    ])) return "netWorth";
    if (whole(utterance, [
      /^(?:our |all our |the household s )?(?:recurring services|recurring charges|ongoing memberships|subscriptions)$/,
      /^(?:what|which) (?:recurring services|services|memberships|subscriptions|recurring charges) (?:are we (?:paying for|subscribed to)|do we (?:pay for|have))$/
    ])) return "subscriptions";
    if (whole(utterance, [
      /^(?:our |the )?unused (?:subscriptions|memberships)$/,
      /^(?:which |what )?(?:subscriptions|memberships) (?:are unused|are we not using|do we no longer use|do we not use)$/
    ])) { scope.filter = "unused"; return "subscriptions"; }
    if (whole(utterance, [
      /^(?:which |what )?bills (?:are (?:coming up|due)|come due)(?: next| soon)?$/, /^upcoming bills$/, /^bills due(?: next| soon)?$/
    ])) { scope.filter = "bills"; return "upcoming"; }
    if (whole(utterance, [
      /^what (?:is )?(?:coming up|upcoming|on our schedule|scheduled next)$/, /^(?:our |the )?(?:upcoming schedule|schedule|upcoming items|scheduled items)$/
    ])) return "upcoming";
    if (whole(utterance, [
      /^(?:what|which) (?:entries|transactions|items) (?:still )?(?:need|require) (?:a look|a second look|review|checking|attention)$/,
      /^what (?:still )?(?:needs (?:a look|checking|attention|review)|is (?:left |waiting )?(?:to|for) review)$/, /^(?:our |the )?review queue$/
    ])) return "review";
    return null;
  }

  // A proposed household summary must still account for every word. Money available now and net worth
  // are the only eligible interpretations. The page presents the proposed metric before calculating it.
  const summaryWords = new Set(("what where how do does are is can we our the household family much money funds resources " +
    "position standing stand financially financial finances picture look looking like overall current currently " +
    "have left with now right readily accessible access available immediately liquid cash balance wealth net worth").split(" "));
  function summaryCandidates(text, scope) {
    if (Object.keys(scope).length || !/^(?:what|where|how) /.test(text) || !/\b(?:we|our)\b/.test(text)) return [];
    // Debts are supported solely as the deduction in net worth. A debt balance by itself is a different question.
    const deductDebts = / (?:after|minus|less) (?:what we owe|our debts|our liabilities)$/;
    const base = text.replace(deductDebts, "");
    const tokens = base.split(" ");
    if (tokens.length > 20 || !tokens.every(word => summaryWords.has(word))) return [];
    const liquid = /\b(?:cash|liquid|accessible|access|available)\b/.test(base);
    const net = base !== text || /\b(?:wealth|net worth|worth)\b/.test(base);
    if (liquid && net) return [];
    if (liquid) return ["cash"];
    if (net) return ["netWorth"];
    if (/\b(?:stand|standing|position|picture)\b/.test(base) && /\b(?:financial|financially|finances)\b/.test(base)) return ["cash", "netWorth"];
    return [];
  }

  function prepare(question, context) {
    if (!validText(question, 600)) return refused("invalid_question");
    if (/[\[\]<>`{}@$£€¥₹]|:\/\/|www\.|\b(?:send|email|upload|export|execute|delete|overwrite|publish|forward|webhook|chatgpt|claude)\b/i.test(question)) return refused("unsupported_action");
    if (/\b(?:receipts?|invoices?|attachments?|statements?|photos?|documents?|pdf|csv)\b/i.test(question)) return refused("unsupported_scope");
    if (/\?\s*\S|;/.test(question)) return refused("multiple_requests");
    const input = words(question);
    if (!input.length || input.length > 100) return refused("invalid_question");
    const aliases = dictionary(context);
    if (!aliases) return refused("invalid_context");
    const matched = ground(input, aliases);
    if (!matched) return refused("ambiguous_scope");
    const { text, scope } = matched;
    if (/\b(?:and|or|also|plus|versus|vs|compare|compared|both|then)\b/.test(text.replace(/\bcash and offset\b/g, "cash"))) return refused("multiple_requests");
    if (text.length > 600) return refused("invalid_question");
    const localKind = coveredRoute(text, scope);
    const kinds = localKind ? [localKind] : summaryCandidates(text, scope);
    if (!kinds.length) return refused("unsupported_scope");
    const prepared = Object.freeze({ status: "prepared", maskedQuestion: text, scope: Object.freeze(scope) });
    preparedRoutes.set(prepared, { localKind, kinds });
    return prepared;
  }

  function local(prepared) {
    const kind = preparedRoutes.get(prepared)?.localKind;
    return kind ? Object.freeze({ status: "classified", kind, ...prepared.scope }) : null;
  }

  function alternatives(prepared) {
    const kinds = preparedRoutes.get(prepared)?.kinds || [];
    return Object.freeze(kinds.map(kind => Object.freeze({ kind, ...prepared.scope })));
  }

  function validate(prepared, proposal) {
    const allowed = preparedRoutes.get(prepared);
    if (!allowed) return refused("invalid_preparation");
    if (!onlyKeys(proposal, ["status", "kind", "coverage", "reason"])) return refused("invalid_proposal");
    if (proposal.status === "unavailable") return refused("inference_unavailable", "unavailable");
    if (proposal.status !== "proposed" || proposal.coverage !== "complete" || !allowed.kinds.includes(proposal.kind)) return refused("unsupported_question");
    return Object.freeze({ status: "classified", kind: proposal.kind, ...prepared.scope });
  }

  return Object.freeze({ prepare, local, alternatives, validate });
});
