from scripts.export_uw_facilities import FacilitiesParser, import_sql


def test_facilities_keep_categories_links_and_parent_building():
    html = """<sl-tab-panel name="departments"><ul>
    <li><a href="https://library.wisc.edu/college">College Library</a></li>
    <li>Writing Center</li></ul></sl-tab-panel>
    <sl-tab-panel name="dining">
    <sl-details summary="Open Book Café" id="details_dining_25">
    <p>Coffee &amp; snacks</p><a href="/hours">Hours</a>
    </sl-details></sl-tab-panel>"""
    parser = FacilitiesParser("490")
    parser.feed(html)
    assert [(r["category"], r["name"]) for r in parser.rows] == [
        ("departments", "College Library"),
        ("departments", "Writing Center"),
        ("dining", "Open Book Café"),
    ]
    assert all(r["uw_map_object_id"] == "490" for r in parser.rows)
    assert parser.rows[1]["links"] == []
    cafe = parser.rows[2]
    assert "Coffee & snacks" in cafe["description"]
    assert cafe["links"][0]["url"] == "https://map.wisc.edu/hours"
    again = FacilitiesParser("490")
    again.feed(html)
    assert again.rows == parser.rows
    sql = import_sql(parser.rows)
    assert "Missing parent building" in sql
    assert "ON CONFLICT(id) DO UPDATE" in sql
    assert "DELETE FROM" not in sql


def test_empty_and_info_only_panels_do_not_create_facilities():
    parser = FacilitiesParser("1")
    parser.feed('<sl-tab-panel name="info"><li>Street address</li></sl-tab-panel>')
    assert parser.rows == []
