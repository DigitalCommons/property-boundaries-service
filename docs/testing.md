# Testing

## Unit tests

To run all UTs, run `npm run test`.

## Adding Dummy Data

There is a route to add dummy data, usually found as a `POST` on `http://localhost:4000/test-data?secret=<your-secret>`. The route adds an ownership and a polygon at the same time. Note, the polygon insert method can only handle simple loops currently, so start and end the polygon with the same coordinates.

Here's some example JSON you could use, this is set-up for the social housing test:
```
{
    "title_no": "JK420",
    "proprietor_name_1": "700 Club",
    "geom": {
        "type": "Polygon",
    "coordinates": [[[1.5,55],[1.5001,55.001],[1.501,55.01],[1.502,55.02],[1.5,55]]]
    }
}
```

So this would come back if using the `GET` on `http://localhost:4001/boundaries?sw_lng=1&sw_lat=40&ne_lng=3&ne_lat=60&type=socialHousing&secret=<your-secret>`.

