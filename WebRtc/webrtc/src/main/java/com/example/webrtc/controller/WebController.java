package com.example.webrtc.controller;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
public class WebController {

    /**
     * Forwards React Router paths back to index.html so that client-side
     * routing can take over and resolve the paths correctly.
     */
    @RequestMapping(value = { "/", "/room/**" })
    public String forwardReactRoutes() {
        return "forward:/index.html";
    }
}
