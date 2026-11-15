using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using Taskii.Core.Days;

namespace Taskii.Core.Search;

/// <summary>
/// Finds tasks and notes across all days.
/// <para>
/// Content is copied forward every day, so the same task or note is in many files. The index
/// stores each distinct state of an item once and records which days it was in that state, so
/// a task is one result however long it lived. A task is followed by its ID; a note has none
/// and is identified by its content, so an edited note is a new note.
/// </para>
/// <para>
/// The database is a cache of the day files. It can be deleted at any time, and it belongs
/// outside the synced data folder.
/// </para>
/// </summary>
public sealed class SearchIndex : IDisposable
{
    /// <summary>Raised whenever the tables change shape, which rebuilds the index from the files.</summary>
    private const int Schema = 3;

    /// <summary>How many related items are worth listing.</summary>
    private const int MaxRelated = 8;

    // What a state points at, in the refs table.
    private const string BlockerPrefix = "b:";
    private const string TicketPrefix = "k:";

    private const string DateFormat = "yyyy-MM-dd";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly Lock _gate = new();
    private readonly DayStore _store;
    private readonly string _path;
    private SqliteConnection? _db;

    public SearchIndex(DayStore store, string databasePath)
    {
        _store = store;
        _path = Path.GetFullPath(databasePath);
    }

    public void Dispose()
    {
        lock (_gate)
        {
            _db?.Dispose();
            _db = null;
        }
    }

    /// <summary>
    /// Catches up with the day files: reads the ones that are new or changed since last time
    /// and forgets the ones that are gone. Cheap when nothing has changed.
    /// </summary>
    /// <returns>Whether anything was different.</returns>
    public bool Refresh()
    {
        lock (_gate)
        {
            var db = Open();

            var known = new Dictionary<string, (long Size, long Modified)>(StringComparer.Ordinal);
            using (var read = Command(db, "SELECT date, size, mtime FROM days"))
            using (var rows = read.ExecuteReader())
            {
                while (rows.Read()) known[rows.GetString(0)] = (rows.GetInt64(1), rows.GetInt64(2));
            }

            var stale = new List<(DateOnly Date, long Size, long Modified)>();
            foreach (var date in _store.ListDays())
            {
                var file = new FileInfo(_store.PathFor(date));
                if (!file.Exists) continue;

                var stamp = (file.Length, file.LastWriteTimeUtc.Ticks);
                if (!known.Remove(Format(date), out var seen) || seen != stamp) stale.Add((date, stamp.Length, stamp.Ticks));
            }

            // What is left in `known` no longer has a file.
            if (stale.Count == 0 && known.Count == 0) return false;

            using var transaction = db.BeginTransaction();

            foreach (var gone in known.Keys)
            {
                Run(db, "DELETE FROM occ WHERE date = $date", ("$date", gone));
                Run(db, "DELETE FROM parts WHERE date = $date", ("$date", gone));
                Run(db, "DELETE FROM days WHERE date = $date", ("$date", gone));
            }

            foreach (var (date, size, modified) in stale)
            {
                DaySnapshot snapshot;
                try
                {
                    snapshot = _store.Load(date);
                }
                catch (IOException)
                {
                    // Held by a sync client for longer than is worth waiting. Next time.
                    continue;
                }

                if (!snapshot.Exists) continue;
                Write(db, Format(date), snapshot.File.Content);
                Run(db, "INSERT OR REPLACE INTO days(date, size, mtime) VALUES ($date, $size, $mtime)", ("$date", Format(date)), ("$size", size), ("$mtime", modified));
            }

            // States that no day is in any more.
            Run(db, "DELETE FROM fts WHERE rowid IN (SELECT id FROM versions WHERE hash NOT IN (SELECT hash FROM occ))");
            Run(db, "DELETE FROM refs WHERE hash NOT IN (SELECT hash FROM occ)");
            Run(db, "DELETE FROM versions WHERE hash NOT IN (SELECT hash FROM occ)");

            transaction.Commit();
            return true;
        }
    }

    public SearchResults Search(SearchQuery query)
    {
        var match = MatchExpression(query.Text);
        var parameters = new List<(string, object)>();

        // The states that match, then the items that were ever in one of them. Each item is
        // shown as it was on the latest day it matched, with the span of its whole life.
        var sql = new StringBuilder("WITH hit(hash) AS (SELECT v.hash FROM versions v");
        if (match is not null)
        {
            sql.Append(" JOIN fts ON fts.rowid = v.id WHERE fts MATCH $match");
            parameters.Add(("$match", match));
        }
        else
        {
            sql.Append(" WHERE 1");
        }

        if (query.Kind is { } kind)
        {
            sql.Append(" AND v.kind = $kind");
            parameters.Add(("$kind", (int)kind));
        }

        if (!string.IsNullOrWhiteSpace(query.Tag))
        {
            sql.Append(" AND v.tag = $tag COLLATE NOCASE");
            parameters.Add(("$tag", query.Tag.Trim()));
        }

        sql.Append("""
            ),
            life AS (
              SELECT o.key AS key, MIN(o.date) AS first, MAX(o.date) AS last, COUNT(*) AS days,
                     MAX(CASE WHEN o.hash IN (SELECT hash FROM hit) THEN o.date END) AS shown
              FROM occ o
              WHERE o.key IN (SELECT key FROM occ WHERE hash IN (SELECT hash FROM hit))
              GROUP BY o.key
            ),
            res AS (
              SELECT l.key AS key, l.first AS first, l.last AS last, l.days AS days,
                     vs.kind AS kind, vs.title AS title, vs.body AS body, vs.tag AS tag, vl.done AS done
              FROM life l
              JOIN occ os ON os.key = l.key AND os.date = l.shown JOIN versions vs ON vs.hash = os.hash
              JOIN occ ol ON ol.key = l.key AND ol.date = l.last JOIN versions vl ON vl.hash = ol.hash
            """);

        if (query.State != TaskState.Any)
        {
            sql.Append(" WHERE vl.kind = 0 AND vl.done = $done");
            parameters.Add(("$done", query.State == TaskState.Done ? 1 : 0));
        }

        sql.Append(')');
        var common = sql.ToString();
        var limit = Math.Max(1, query.Limit);

        lock (_gate)
        {
            var db = Open();
            var hits = new List<SearchHit>();

            using (var command = Command(db, common + " SELECT key, kind, title, body, tag, done, first, last, days FROM res ORDER BY last DESC, first DESC, title LIMIT $limit", [.. parameters, ("$limit", limit)]))
            using (var rows = command.ExecuteReader())
            {
                while (rows.Read())
                {
                    hits.Add(new SearchHit(
                        rows.GetString(0),
                        (ItemKind)rows.GetInt32(1),
                        rows.GetString(2),
                        rows.GetString(3),
                        rows.IsDBNull(4) ? null : rows.GetString(4),
                        rows.GetInt32(5) != 0,
                        Parse(rows.GetString(6)),
                        Parse(rows.GetString(7)),
                        rows.GetInt32(8)));
                }
            }

            if (hits.Count == 0) return SearchResults.None;

            using var totals = Command(db, common + " SELECT (SELECT COUNT(*) FROM res), (SELECT COUNT(DISTINCT o.date) FROM occ o WHERE o.key IN (SELECT key FROM res))", [.. parameters]);
            using var total = totals.ExecuteReader();
            total.Read();
            return new SearchResults(hits, total.GetInt32(0), total.GetInt32(1));
        }
    }

    /// <summary>Every day an item appears on and what it looked like on each. Null if it is not in the index.</summary>
    public ItemHistory? History(string key)
    {
        lock (_gate)
        {
            var db = Open();
            var days = new List<ItemDay>();
            var versions = new List<ItemVersion>();
            var indexOf = new Dictionary<string, int>(StringComparer.Ordinal);
            var kind = ItemKind.Task;

            var hashes = new List<string>();
            using (var command = Command(db, "SELECT o.date, o.hash, v.kind, v.json FROM occ o JOIN versions v ON v.hash = o.hash WHERE o.key = $key ORDER BY o.date", ("$key", key)))
            using (var rows = command.ExecuteReader())
            {
                while (rows.Read())
                {
                    var hash = rows.GetString(1);
                    if (!indexOf.TryGetValue(hash, out var index))
                    {
                        index = versions.Count;
                        indexOf[hash] = index;
                        hashes.Add(hash);
                        versions.Add(JsonSerializer.Deserialize<ItemVersion>(rows.GetString(3), Json)!);
                    }

                    kind = (ItemKind)rows.GetInt32(2);
                    days.Add(new ItemDay(Parse(rows.GetString(0)), index));
                }
            }

            if (days.Count == 0) return null;
            return new ItemHistory(key, kind, days, versions, [.. hashes.Select(hash => Related(db, key, hash))]);
        }
    }

    /// <summary>
    /// What an item in one state has to do with: the task it is blocked by, the tasks it
    /// blocks, and whatever else mentions a ticket it mentions.
    /// </summary>
    private static IReadOnlyList<RelatedItem> Related(SqliteConnection db, string key, string hash)
    {
        var related = new List<RelatedItem>();

        // The blocker as it is on its own last day: whether it has been done since is the point.
        using (var command = Command(
            db,
            """
            SELECT o.key, v.title, v.done, MAX(o.date)
            FROM refs r JOIN occ o ON o.key = 't:' || substr(r.ref, 3) JOIN versions v ON v.hash = o.hash
            WHERE r.hash = $hash AND r.ref LIKE 'b:%' AND o.key <> $key
            GROUP BY o.key
            """,
            ("$hash", hash),
            ("$key", key)))
        using (var rows = command.ExecuteReader())
        {
            while (rows.Read())
            {
                related.Add(new RelatedItem(rows.GetString(0), ItemKind.Task, Relation.BlockedBy, rows.GetString(1), rows.GetInt32(2) != 0, Parse(rows.GetString(3)), null));
            }
        }

        // The others are shown as they were on the last day they had the link. With a single
        // MAX, SQLite takes the other columns from the row that holds it.
        void Collect(Relation relation, string where, (string, object) parameter)
        {
            using var command = Command(
                db,
                $"""
                 SELECT o.key, v.kind, v.title, v.done, MAX(o.date), r.ref
                 FROM refs r JOIN occ o ON o.hash = r.hash JOIN versions v ON v.hash = o.hash
                 WHERE {where} AND o.key <> $key
                 GROUP BY o.key
                 ORDER BY MAX(o.date) DESC, v.title
                 """,
                parameter,
                ("$key", key));
            using var rows = command.ExecuteReader();
            while (rows.Read())
            {
                related.Add(new RelatedItem(
                    rows.GetString(0),
                    (ItemKind)rows.GetInt32(1),
                    relation,
                    rows.GetString(2),
                    rows.GetInt32(3) != 0,
                    Parse(rows.GetString(4)),
                    relation == Relation.Ticket ? rows.GetString(5)[TicketPrefix.Length..] : null));
            }
        }

        if (key.StartsWith("t:", StringComparison.Ordinal)) Collect(Relation.Blocks, "r.ref = $ref", ("$ref", BlockerPrefix + key[2..]));
        Collect(Relation.Ticket, "r.ref IN (SELECT ref FROM refs WHERE hash = $hash AND ref LIKE 'k:%')", ("$hash", hash));

        // An edited note is a new note, so one that was touched every day would be listed once
        // per day. Its newest state stands for all of them. A task is listed once, too.
        var seen = new HashSet<string>(StringComparer.Ordinal);
        if (key.StartsWith("n:", StringComparison.Ordinal))
        {
            // Nor is a note related to what it was before it was edited.
            using var own = Command(db, "SELECT title FROM versions WHERE hash = $hash", ("$hash", hash));
            if (own.ExecuteScalar() is string heading) seen.Add("n " + heading);
        }

        return [.. related.Where(item => seen.Add(item.Kind == ItemKind.Note ? "n " + item.Title : item.Key)).Take(MaxRelated)];
    }

    /// <summary>
    /// Since when each note of a day has read as it does: the first day its card, and each
    /// of its side notes, appears with exactly this text. An edited note is a new one, so
    /// this is how long it has been left alone. One that is in no day file yet is from
    /// <paramref name="date"/> itself.
    /// </summary>
    /// <param name="date">The day the notes are on. Later days are not looked at.</param>
    public IReadOnlyList<NoteSince> NotesSince(IReadOnlyList<NoteCard> notes, DateOnly date)
    {
        lock (_gate)
        {
            var db = Open();
            DateOnly First(string hash)
            {
                using var command = Command(db, "SELECT MIN(date) FROM parts WHERE hash = $hash AND date <= $date", ("$hash", hash), ("$date", Format(date)));
                return command.ExecuteScalar() is string first ? Parse(first) : date;
            }

            return [.. notes.Select(note => new NoteSince(First(CardHash(note)), [.. note.Sides.Select(side => First(SideHash(side)))]))];
        }
    }

    /// <summary>Every tag a task has had, most used first.</summary>
    public IReadOnlyList<string> Tags()
    {
        lock (_gate)
        {
            var db = Open();
            var tags = new List<string>();
            using var command = Command(db, """
                SELECT v.tag FROM versions v JOIN occ o ON o.hash = v.hash
                WHERE v.tag IS NOT NULL
                GROUP BY v.tag COLLATE NOCASE
                ORDER BY COUNT(DISTINCT o.key) DESC, v.tag COLLATE NOCASE
                """);
            using var rows = command.ExecuteReader();
            while (rows.Read()) tags.Add(rows.GetString(0));
            return tags;
        }
    }

    /// <summary>
    /// The full-text query for what was typed: every word, as a prefix, so results narrow
    /// while typing. Null when there is nothing to look for.
    /// </summary>
    internal static string? MatchExpression(string? text)
    {
        var terms = TermsOf(text);
        return terms.Count == 0 ? null : string.Join(' ', terms.Select(term => $"\"{term}\"*"));
    }

    /// <summary>
    /// The words in what was typed, split the way the unicode61 tokenizer splits text, so
    /// "AB#4521" looks for "AB" and "4521". Letters and numbers of any kind (², ½ and Ⅻ too) are
    /// part of a word, read as whole code points. The same rule as termsOf in the page's
    /// search.ts; the cases both are tested on are in tests/rules/cases.json.
    /// </summary>
    internal static IReadOnlyList<string> TermsOf(string? text)
    {
        var terms = new List<string>();
        var word = new StringBuilder();
        foreach (var rune in (text ?? "").EnumerateRunes())
        {
            if (Rune.IsLetter(rune) || Rune.IsNumber(rune))
            {
                word.Append(rune.ToString());
            }
            else if (word.Length > 0)
            {
                terms.Add(word.ToString());
                word.Clear();
            }
        }

        if (word.Length > 0) terms.Add(word.ToString());
        return terms;
    }

    // ---- writing ----

    private static void Write(SqliteConnection db, string date, DayContent day)
    {
        Run(db, "DELETE FROM occ WHERE date = $date", ("$date", date));
        Run(db, "DELETE FROM parts WHERE date = $date", ("$date", date));

        foreach (var (section, tasks) in new[] { ("todo", day.Todo), ("backlog", day.Backlog) })
        {
            foreach (var task in tasks)
            {
                if (task.Title.Length == 0 && task.Body.Length == 0) continue;

                // A line typed into the file by hand has no ID yet. Its title has to do.
                var key = task.Id.Length > 0 ? "t:" + task.Id : "t~" + Hash(task.Title);
                var hash = Hash(key, section, DayFormat.Task(task));
                var refs = TaskFields.BlockersOf(task)
                    .Select(id => BlockerPrefix + id)
                    .Concat(TicketRefs.In(task.Title + '\n' + task.Body).Select(ticket => TicketPrefix + ticket));
                Add(db, date, key, hash, ItemKind.Task, TaskTags.Of(task.Title), task.Done, task.Title, task.Body, new ItemVersion(section, task, null), refs);
            }
        }

        foreach (var note in day.Notes)
        {
            if (note.Heading.Length == 0 && note.Body.Length == 0 && note.Sides.Count == 0) continue;

            var key = "n:" + Hash([DayFormat.Card(note), .. note.Sides.Select(DayFormat.Side)]);
            var body = string.Join('\n', new[] { note.Body }.Concat(note.Sides.SelectMany(side => new[] { side.Heading, side.Body })).Where(part => part.Length > 0));
            var refs = TicketRefs.In(note.Heading + '\n' + body).Select(ticket => TicketPrefix + ticket);
            Add(db, date, key, key, ItemKind.Note, null, false, note.Heading, body, new ItemVersion("notes", null, note), refs);

            // A card and its side notes each age on their own: adding to a side note does not make the card new.
            foreach (var part in new[] { CardHash(note) }.Concat(note.Sides.Select(SideHash)))
            {
                Run(db, "INSERT OR IGNORE INTO parts(hash, date) VALUES ($hash, $date)", ("$hash", part), ("$date", date));
            }
        }
    }

    private static string CardHash(NoteCard note) => Hash(DayFormat.Card(note));

    private static string SideHash(SideNote side) => Hash(DayFormat.Side(side));

    private static void Add(SqliteConnection db, string date, string key, string hash, ItemKind kind, string? tag, bool done, string title, string body, ItemVersion version, IEnumerable<string> refs)
    {
        var added = Run(
            db,
            "INSERT OR IGNORE INTO versions(hash, kind, tag, done, title, body, json) VALUES ($hash, $kind, $tag, $done, $title, $body, $json)",
            ("$hash", hash),
            ("$kind", (int)kind),
            ("$tag", (object?)tag ?? DBNull.Value),
            ("$done", done ? 1 : 0),
            ("$title", title),
            ("$body", body),
            ("$json", JsonSerializer.Serialize(version, Json)));

        if (added > 0)
        {
            Run(db, "INSERT INTO fts(rowid, title, body) VALUES (last_insert_rowid(), $title, $body)", ("$title", title), ("$body", body));
            foreach (var reference in refs) Run(db, "INSERT OR IGNORE INTO refs(ref, hash) VALUES ($ref, $hash)", ("$ref", reference), ("$hash", hash));
        }

        // The same note twice on one day, or an ID used twice, is one item that day.
        Run(db, "INSERT OR IGNORE INTO occ(key, date, hash) VALUES ($key, $date, $hash)", ("$key", key), ("$date", date), ("$hash", hash));
    }

    private static string Hash(params string[] parts) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\u001f', parts))), 0, 12);

    // ---- the database ----

    private SqliteConnection Open()
    {
        if (_db is not null) return _db;

        try
        {
            return _db = Create();
        }
        catch (SqliteException)
        {
            // Not a database, or a damaged one. It is only a cache: start again.
            SqliteConnection.ClearAllPools();
            foreach (var file in new[] { _path, _path + "-wal", _path + "-shm" }) File.Delete(file);
            return _db = Create();
        }
    }

    private SqliteConnection Create()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        var db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = _path, Pooling = false }.ToString());
        try
        {
            db.Open();
            Run(db, "PRAGMA journal_mode = WAL");
            Run(db, "PRAGMA synchronous = NORMAL");

            // An index made for another data folder, or by another version of Taskii, is rebuilt.
            if (Scalar(db, "PRAGMA user_version") is not long schema || schema != Schema || !string.Equals(RootOf(db), _store.Root, StringComparison.OrdinalIgnoreCase))
            {
                using var transaction = db.BeginTransaction();
                Run(db, $"""
                    DROP TABLE IF EXISTS meta;
                    DROP TABLE IF EXISTS days;
                    DROP TABLE IF EXISTS occ;
                    DROP TABLE IF EXISTS versions;
                    DROP TABLE IF EXISTS fts;
                    DROP TABLE IF EXISTS refs;
                    DROP TABLE IF EXISTS parts;

                    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);

                    -- The day files that have been read, and what they looked like then.
                    CREATE TABLE days(date TEXT PRIMARY KEY, size INTEGER NOT NULL, mtime INTEGER NOT NULL);

                    -- Which state each item was in on each day it appears.
                    CREATE TABLE occ(key TEXT NOT NULL, date TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (key, date)) WITHOUT ROWID;
                    CREATE INDEX occ_hash ON occ(hash);
                    CREATE INDEX occ_date ON occ(date);

                    -- Each distinct state of an item, once. kind is 0 for a task and 1 for a note.
                    CREATE TABLE versions(
                      id INTEGER PRIMARY KEY, hash TEXT NOT NULL UNIQUE, kind INTEGER NOT NULL, tag TEXT,
                      done INTEGER NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, json TEXT NOT NULL);

                    -- rowid is versions.id
                    CREATE VIRTUAL TABLE fts USING fts5(title, body, tokenize = 'unicode61 remove_diacritics 2');

                    -- What each state points at: 'b:' and the ID of the task it is blocked by, or 'k:' and a ticket it mentions.
                    CREATE TABLE refs(ref TEXT NOT NULL, hash TEXT NOT NULL, PRIMARY KEY (ref, hash)) WITHOUT ROWID;
                    CREATE INDEX refs_hash ON refs(hash);

                    -- The days each card and each side note appears on, by the text of that part alone.
                    CREATE TABLE parts(hash TEXT NOT NULL, date TEXT NOT NULL, PRIMARY KEY (hash, date)) WITHOUT ROWID;
                    CREATE INDEX parts_date ON parts(date);

                    PRAGMA user_version = {Schema};
                    """);
                Run(db, "INSERT INTO meta(key, value) VALUES ('root', $root)", ("$root", _store.Root));
                transaction.Commit();
            }

            return db;
        }
        catch
        {
            db.Dispose();
            throw;
        }
    }

    private static string? RootOf(SqliteConnection db)
    {
        try
        {
            return Scalar(db, "SELECT value FROM meta WHERE key = 'root'") as string;
        }
        catch (SqliteException e) when (e.SqliteErrorCode == 1)
        {
            // No such table: a database from before there was one.
            return null;
        }
    }

    private static SqliteCommand Command(SqliteConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        var command = db.CreateCommand();
        command.CommandText = sql;
        foreach (var (name, value) in parameters) command.Parameters.AddWithValue(name, value);
        return command;
    }

    private static int Run(SqliteConnection db, string sql, params (string Name, object Value)[] parameters)
    {
        using var command = Command(db, sql, parameters);
        return command.ExecuteNonQuery();
    }

    private static object? Scalar(SqliteConnection db, string sql)
    {
        using var command = Command(db, sql);
        return command.ExecuteScalar();
    }

    private static string Format(DateOnly date) => date.ToString(DateFormat, CultureInfo.InvariantCulture);

    private static DateOnly Parse(string date) => DateOnly.ParseExact(date, DateFormat, CultureInfo.InvariantCulture);
}
