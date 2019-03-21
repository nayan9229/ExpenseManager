import React, { Component } from 'react';

export default class ExpenseIcon extends Component {
  iconFrom(category) {
    switch (category) {
      case "Groceries":
        return "local_grocery_store";
      case "Restaurants":
        return "local_dining";
      case "Car":
        return "directions_car";
      case "Hobbies":
        return "local_library";
      case "Household":
        return "home";
      case "Shopping":
        return "local_mall";
      case "Health":
        return "local_hospital";
      case "Entertainment":
        return "local_movies";
      case "X":
        return "smoke_free";
      case "IceCream":
        return "free_breakfast";
      case "BreakFast":
        return "fastfood";
      case "Milk":
        return "local_cafe";
      case "Vgg&fruits":
        return "local_shipping";
      case "Petrol":
        return "local_gas_station";
      default:
        return "attach_money";
    }
  }

  render() {
    return (
      <span
        className={`mdc-list-item__start-detail ${this.props.category}`}
        role="presentation"
      >
        <i className="material-icons" aria-hidden="true">
          {this.iconFrom(this.props.category)}
        </i>
      </span>
    );
  }
}
